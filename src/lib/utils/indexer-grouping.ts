/**
 * Utility: Indexer Grouping by Categories
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Groups indexers by their category configuration to minimize API calls.
 * Indexers with identical categories are grouped together for a single search.
 * Supports separate audiobook and ebook category configurations per indexer.
 */

export type CategoryType = 'audiobook' | 'ebook';

export interface IndexerConfig {
  id: number;
  name: string;
  priority?: number;
  audiobookCategories?: number[]; // Categories for audiobook searches
  ebookCategories?: number[]; // Categories for ebook searches
  categories?: number[]; // Legacy field for backwards compatibility
  [key: string]: any; // Allow other properties
}

export interface IndexerGroup {
  categories: number[];
  indexerIds: number[];
  indexers: IndexerConfig[];
}

/**
 * Gets the appropriate categories from an indexer based on the category type.
 *
 * @param indexer - The indexer configuration
 * @param type - The category type ('audiobook' or 'ebook')
 * @returns Array of category IDs
 */
export function getCategoriesForType(indexer: IndexerConfig, type: CategoryType): number[] {
  if (type === 'ebook') {
    return indexer.ebookCategories && indexer.ebookCategories.length > 0
      ? indexer.ebookCategories
      : [7020]; // Default ebook category
  }

  // Audiobook - check new field first, then legacy field
  if (indexer.audiobookCategories && indexer.audiobookCategories.length > 0) {
    return indexer.audiobookCategories;
  }
  if (indexer.categories && indexer.categories.length > 0) {
    return indexer.categories; // Legacy fallback
  }
  return [3030]; // Default audiobook category
}

/**
 * Groups indexers by their category configuration.
 * Indexers with identical category arrays are grouped together.
 *
 * @param indexers - Array of indexer configurations
 * @param type - The category type to group by ('audiobook' or 'ebook')
 * @returns Array of groups, each containing indexers with matching categories
 *
 * @example
 * const indexers = [
 *   { id: 1, audiobookCategories: [3030], ebookCategories: [7020] },
 *   { id: 2, audiobookCategories: [3030], ebookCategories: [7020] },
 *   { id: 3, audiobookCategories: [3030, 3010], ebookCategories: [7020] },
 * ];
 *
 * const audiobookGroups = groupIndexersByCategories(indexers, 'audiobook');
 * // Result:
 * // [
 * //   { categories: [3030], indexerIds: [1, 2], indexers: [...] },
 * //   { categories: [3030, 3010], indexerIds: [3], indexers: [...] }
 * // ]
 *
 * const ebookGroups = groupIndexersByCategories(indexers, 'ebook');
 * // Result:
 * // [
 * //   { categories: [7020], indexerIds: [1, 2, 3], indexers: [...] }
 * // ]
 */
export function groupIndexersByCategories(
  indexers: IndexerConfig[],
  type: CategoryType = 'audiobook'
): IndexerGroup[] {
  // Map to track unique category combinations
  // Key: sorted category IDs as string (e.g., "3030,3010")
  // Value: array of indexers with those categories
  const groupMap = new Map<string, IndexerConfig[]>();

  for (const indexer of indexers) {
    // Get categories for the specified type
    const categories = getCategoriesForType(indexer, type);

    // Sort categories to ensure consistent grouping
    // [3030, 3010] and [3010, 3030] should be the same group
    const sortedCategories = [...categories].sort((a, b) => a - b);
    const key = sortedCategories.join(',');

    // Add indexer to group
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(indexer);
  }

  // Convert map to array of groups
  const groups: IndexerGroup[] = [];
  for (const [key, indexersInGroup] of groupMap.entries()) {
    const categories = key.split(',').map(Number);
    const indexerIds = indexersInGroup.map(idx => idx.id);

    groups.push({
      categories,
      indexerIds,
      indexers: indexersInGroup,
    });
  }

  return groups;
}

/**
 * Get a human-readable description of an indexer group.
 * Useful for logging and debugging.
 *
 * @param group - The indexer group
 * @returns Description string
 *
 * @example
 * const description = getGroupDescription(group);
 * // "3 indexers (IDs: 1, 2, 5) searching categories [3030, 3010]"
 */
export function getGroupDescription(group: IndexerGroup): string {
  const indexerCount = group.indexerIds.length;
  const indexerNames = group.indexers.map(idx => idx.name).join(', ');
  const categoriesStr = group.categories.join(', ');

  return `${indexerCount} indexer${indexerCount > 1 ? 's' : ''} (${indexerNames}) with categories [${categoriesStr}]`;
}
