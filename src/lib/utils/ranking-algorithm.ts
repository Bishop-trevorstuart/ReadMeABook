/**
 * Component: Intelligent Ranking Algorithm
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { compareTwoStrings } from 'string-similarity';

export interface TorrentResult {
  indexer: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  publishDate: Date;
  downloadUrl: string;
  infoHash?: string;
  guid: string;
  format?: 'M4B' | 'M4A' | 'MP3' | 'OTHER';
  bitrate?: string;
  hasChapters?: boolean;
}

export interface AudiobookRequest {
  title: string;
  author: string;
  narrator?: string;
  durationMinutes?: number;
}

export interface ScoreBreakdown {
  formatScore: number;
  seederScore: number;
  sizeScore: number;
  matchScore: number;
  totalScore: number;
  notes: string[];
}

export interface RankedTorrent extends TorrentResult {
  score: number;
  rank: number;
  breakdown: ScoreBreakdown;
}

export class RankingAlgorithm {
  /**
   * Rank all torrents and return sorted by score (best first)
   */
  rankTorrents(
    torrents: TorrentResult[],
    audiobook: AudiobookRequest
  ): RankedTorrent[] {
    const ranked = torrents.map((torrent) => {
      const formatScore = this.scoreFormat(torrent);
      const seederScore = this.scoreSeeders(torrent.seeders);
      const sizeScore = this.scoreSize(torrent.size, audiobook.durationMinutes);
      const matchScore = this.scoreMatch(torrent, audiobook);

      const totalScore = formatScore + seederScore + sizeScore + matchScore;

      return {
        ...torrent,
        score: totalScore,
        rank: 0, // Will be assigned after sorting
        breakdown: {
          formatScore,
          seederScore,
          sizeScore,
          matchScore,
          totalScore,
          notes: this.generateNotes(torrent, {
            formatScore,
            seederScore,
            sizeScore,
            matchScore,
            totalScore,
            notes: [],
          }),
        },
      };
    });

    // Sort by score descending (best first)
    ranked.sort((a, b) => b.score - a.score);

    // Assign ranks
    ranked.forEach((r, index) => {
      r.rank = index + 1;
    });

    return ranked;
  }

  /**
   * Get detailed scoring breakdown for a torrent
   */
  getScoreBreakdown(
    torrent: TorrentResult,
    audiobook: AudiobookRequest
  ): ScoreBreakdown {
    const formatScore = this.scoreFormat(torrent);
    const seederScore = this.scoreSeeders(torrent.seeders);
    const sizeScore = this.scoreSize(torrent.size, audiobook.durationMinutes);
    const matchScore = this.scoreMatch(torrent, audiobook);
    const totalScore = formatScore + seederScore + sizeScore + matchScore;

    return {
      formatScore,
      seederScore,
      sizeScore,
      matchScore,
      totalScore,
      notes: this.generateNotes(torrent, {
        formatScore,
        seederScore,
        sizeScore,
        matchScore,
        totalScore,
        notes: [],
      }),
    };
  }

  /**
   * Score format quality (25 points max)
   * M4B with chapters: 25 pts
   * M4B without chapters: 22 pts
   * M4A: 16 pts
   * MP3: 10 pts
   * Other: 3 pts
   */
  private scoreFormat(torrent: TorrentResult): number {
    const format = this.detectFormat(torrent);

    switch (format) {
      case 'M4B':
        return torrent.hasChapters !== false ? 25 : 22;
      case 'M4A':
        return 16;
      case 'MP3':
        return 10;
      default:
        return 3;
    }
  }

  /**
   * Score seeder count (15 points max)
   * Logarithmic scaling:
   * 1 seeder: 0 points
   * 10 seeders: 6 points
   * 100 seeders: 12 points
   * 1000+ seeders: 15 points
   */
  private scoreSeeders(seeders: number): number {
    if (seeders === 0) return 0;
    return Math.min(15, Math.log10(seeders + 1) * 6);
  }

  /**
   * Score size reasonableness (10 points max)
   * Expected: 1-2 MB per minute (64-128 kbps)
   * Perfect match: 10 points
   * Too small/large: Reduced points
   */
  private scoreSize(size: number, durationMinutes?: number): number {
    if (!durationMinutes) {
      return 5; // Neutral score if duration unknown
    }

    // Expected size: 1-2 MB per minute
    const minExpected = durationMinutes * 1024 * 1024; // 1 MB/min
    const maxExpected = durationMinutes * 2 * 1024 * 1024; // 2 MB/min

    if (size >= minExpected && size <= maxExpected) {
      return 10; // Perfect size
    }

    // Calculate deviation penalty
    const deviation =
      size < minExpected
        ? (minExpected - size) / minExpected
        : (size - maxExpected) / maxExpected;

    return Math.max(0, 10 - deviation * 10);
  }

  /**
   * Score title/author match quality (50 points max)
   * Title similarity: 0-35 points (heavily weighted!)
   * Author presence: 0-15 points
   */
  private scoreMatch(
    torrent: TorrentResult,
    audiobook: AudiobookRequest
  ): number {
    const torrentTitle = torrent.title.toLowerCase();
    const requestTitle = audiobook.title.toLowerCase();
    const requestAuthor = audiobook.author.toLowerCase();

    // ========== STAGE 1: WORD COVERAGE FILTER (MANDATORY) ==========
    // Extract significant words (filter out common stop words)
    const stopWords = ['the', 'a', 'an', 'of', 'on', 'in', 'at', 'by', 'for'];

    const extractWords = (text: string, stopList: string[]): string[] => {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .split(/\s+/)
        .filter(word => word.length > 0 && !stopList.includes(word));
    };

    const requestWords = extractWords(requestTitle, stopWords);
    const torrentWords = extractWords(torrentTitle, stopWords);

    // Calculate word coverage: how many REQUEST words appear in TORRENT
    if (requestWords.length === 0) {
      // Edge case: title is only stop words, skip filter
      // Fall through to normal scoring
    } else {
      const matchedWords = requestWords.filter(word => torrentWords.includes(word));
      const coverage = matchedWords.length / requestWords.length;

      // HARD REQUIREMENT: Must have 80%+ word coverage
      if (coverage < 0.80) {
        // Automatic rejection - doesn't contain enough of the requested words
        return 0;
      }
    }

    // ========== STAGE 2: TITLE MATCHING (0-35 points) ==========
    let titleScore = 0;
    if (torrentTitle.includes(requestTitle)) {
      // Found the title, but is it the complete title or part of a longer one?
      const titleIndex = torrentTitle.indexOf(requestTitle);
      const afterTitle = torrentTitle.substring(titleIndex + requestTitle.length);

      // Title is complete if followed by clear metadata markers
      // (not followed by more title words like "'s Secret" or " Is Watching")
      const metadataMarkers = [' by ', ' - ', ' [', ' (', ' {', ' :', ','];
      const isCompleteTitle = afterTitle === '' ||
                              metadataMarkers.some(marker => afterTitle.startsWith(marker));

      if (isCompleteTitle) {
        // Complete title match → full points
        titleScore = 35;
      } else {
        // Title continues with more words (e.g., "The Housemaid" + "'s Secret")
        // This is likely a different book in a series → use fuzzy similarity
        titleScore = compareTwoStrings(requestTitle, torrentTitle) * 35;
      }
    } else {
      // No substring match at all → use fuzzy similarity
      titleScore = compareTwoStrings(requestTitle, torrentTitle) * 35;
    }

    // ========== STAGE 3: AUTHOR MATCHING (0-15 points) ==========
    // Parse requested authors (split on separators, filter out roles)
    const requestAuthors = requestAuthor
      .split(/,|&| and | - /)
      .map(a => a.trim())
      .filter(a => a.length > 2 && !['translator', 'narrator'].includes(a));

    // Check how many authors appear in torrent title (exact substring match)
    const authorMatches = requestAuthors.filter(author =>
      torrentTitle.includes(author)
    );

    let authorScore = 0;
    if (authorMatches.length > 0) {
      // Exact substring match → proportional credit
      authorScore = (authorMatches.length / requestAuthors.length) * 15;
    } else {
      // No exact match → use fuzzy similarity for partial credit
      authorScore = compareTwoStrings(requestAuthor, torrentTitle) * 15;
    }

    return Math.min(50, titleScore + authorScore);
  }

  /**
   * Detect format from torrent title
   */
  private detectFormat(torrent: TorrentResult): 'M4B' | 'M4A' | 'MP3' | 'OTHER' {
    // Use explicit format if provided
    if (torrent.format) {
      return torrent.format;
    }

    const title = torrent.title.toUpperCase();

    // Check for format keywords in title
    if (title.includes('M4B')) return 'M4B';
    if (title.includes('M4A')) return 'M4A';
    if (title.includes('MP3')) return 'MP3';

    // Default to OTHER if no format detected
    return 'OTHER';
  }

  /**
   * Generate human-readable notes about scoring
   */
  private generateNotes(
    torrent: TorrentResult,
    breakdown: ScoreBreakdown
  ): string[] {
    const notes: string[] = [];

    // Format notes
    const format = this.detectFormat(torrent);
    if (format === 'M4B') {
      notes.push('Excellent format (M4B)');
      if (torrent.hasChapters !== false) {
        notes.push('Has chapter markers');
      }
    } else if (format === 'M4A') {
      notes.push('Good format (M4A)');
    } else if (format === 'MP3') {
      notes.push('Acceptable format (MP3)');
    } else {
      notes.push('Unknown or uncommon format');
    }

    // Seeder notes
    if (torrent.seeders === 0) {
      notes.push('⚠️ No seeders available');
    } else if (torrent.seeders < 5) {
      notes.push(`Low seeders (${torrent.seeders})`);
    } else if (torrent.seeders >= 50) {
      notes.push(`Excellent availability (${torrent.seeders} seeders)`);
    }

    // Size notes
    if (breakdown.sizeScore < 5) {
      notes.push('⚠️ Unusual file size');
    }

    // Match notes (now worth 50 points!)
    if (breakdown.matchScore < 20) {
      notes.push('⚠️ Poor title/author match');
    } else if (breakdown.matchScore < 35) {
      notes.push('⚠️ Weak title/author match');
    } else if (breakdown.matchScore >= 45) {
      notes.push('✓ Excellent title/author match');
    }

    // Overall quality assessment
    if (breakdown.totalScore >= 75) {
      notes.push('✓ Excellent choice');
    } else if (breakdown.totalScore >= 55) {
      notes.push('✓ Good choice');
    } else if (breakdown.totalScore < 35) {
      notes.push('⚠️ Consider reviewing this choice');
    }

    return notes;
  }
}

// Singleton instance
let ranker: RankingAlgorithm | null = null;

export function getRankingAlgorithm(): RankingAlgorithm {
  if (!ranker) {
    ranker = new RankingAlgorithm();
  }
  return ranker;
}

/**
 * Helper function to rank torrents using the singleton instance
 */
export function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest
): (RankedTorrent & { qualityScore: number })[] {
  const algorithm = getRankingAlgorithm();
  const ranked = algorithm.rankTorrents(torrents, audiobook);

  // Add qualityScore field for UI compatibility (rounded score)
  return ranked.map((r) => ({
    ...r,
    qualityScore: Math.round(r.score),
  }));
}
