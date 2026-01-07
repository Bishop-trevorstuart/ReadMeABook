/**
 * Component: SABnzbd Integration Service
 * Documentation: documentation/phase3/sabnzbd.md
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';

export interface AddNZBOptions {
  category?: string;
  priority?: 'low' | 'normal' | 'high' | 'force';
  paused?: boolean;
}

export interface NZBInfo {
  nzbId: string;
  name: string;
  size: number; // Bytes
  progress: number; // 0.0 to 1.0
  status: NZBStatus;
  downloadSpeed: number; // Bytes/sec
  timeLeft: number; // Seconds
  category: string;
  downloadPath?: string;
  completedAt?: Date;
  errorMessage?: string;
}

export type NZBStatus =
  | 'downloading'
  | 'queued'
  | 'paused'
  | 'extracting'
  | 'completed'
  | 'failed'
  | 'repairing';

export interface QueueItem {
  nzbId: string;
  name: string;
  size: number; // MB (converted to bytes in getNZB)
  sizeLeft: number; // MB
  percentage: number; // 0-100
  status: string; // "Downloading", "Paused", "Queued"
  timeLeft: string; // "0:15:30" format
  category: string;
  priority: string;
}

export interface HistoryItem {
  nzbId: string;
  name: string;
  category: string;
  status: string; // "Completed", "Failed"
  bytes: string; // Size in bytes (as string)
  failMessage: string;
  storage: string; // Download path
  completedTimestamp: string; // Unix timestamp
  downloadTime: string; // Seconds (as string)
}

export interface SABnzbdConfig {
  version: string;
  categories: Array<{
    name: string;
    dir: string;
  }>;
}

export interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number;
  eta: number;
  state: string;
}

export class SABnzbdService {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;
  private defaultCategory: string;
  private disableSSLVerify: boolean;
  private httpsAgent?: https.Agent;

  constructor(
    baseUrl: string,
    apiKey: string,
    defaultCategory: string = 'readmeabook',
    disableSSLVerify: boolean = false
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey?.trim() || '';
    this.defaultCategory = defaultCategory;
    this.disableSSLVerify = disableSSLVerify;

    // Configure HTTPS agent if SSL verification is disabled
    if (this.disableSSLVerify && this.baseUrl.startsWith('https')) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      httpsAgent: this.httpsAgent,
    });
  }

  /**
   * Test connection to SABnzbd
   */
  async testConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      // Validate API key is not empty
      if (!this.apiKey || this.apiKey.trim() === '') {
        return {
          success: false,
          error: 'API key is required for SABnzbd',
        };
      }

      // Use queue endpoint to test authentication (requires valid API key)
      const response = await this.client.get('/api', {
        params: {
          mode: 'queue',
          output: 'json',
          apikey: this.apiKey,
        },
      });

      // Check if SABnzbd returned an error (invalid API key)
      // SABnzbd can return errors in different formats:
      // - { status: false, error: "message" }
      // - { error: "message" }
      // - Plain text error
      if (response.data?.status === false || response.data?.error) {
        const errorMsg = response.data?.error || 'Authentication failed';
        return {
          success: false,
          error: errorMsg.includes('API Key')
            ? 'Invalid API key. Check your SABnzbd configuration (Config → General → API Key).'
            : errorMsg,
        };
      }

      // Queue endpoint requires auth - if we got here, API key is valid
      // Now get the version
      const version = await this.getVersion();
      return { success: true, version };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Enhanced error messages for common issues
      if (errorMessage.includes('ECONNREFUSED')) {
        return {
          success: false,
          error: 'Connection refused. Is SABnzbd running and accessible at this URL?',
        };
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ENOTFOUND')) {
        return {
          success: false,
          error: 'Connection timed out. Check the URL and network connectivity.',
        };
      } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
        return {
          success: false,
          error: 'SSL/TLS certificate error. Enable "Disable SSL verification" if using self-signed certificates.',
        };
      } else if (errorMessage.includes('API Key Incorrect') || errorMessage.includes('API Key Required')) {
        return {
          success: false,
          error: 'Invalid API key. Check your SABnzbd configuration (Config → General → API Key).',
        };
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get SABnzbd version
   */
  async getVersion(): Promise<string> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'version',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    if (response.data?.version) {
      return response.data.version;
    }

    throw new Error('Failed to get SABnzbd version');
  }

  /**
   * Get SABnzbd configuration
   */
  async getConfig(): Promise<SABnzbdConfig> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'get_config',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    const config = response.data?.config;
    if (!config) {
      throw new Error('Failed to get SABnzbd configuration');
    }

    return {
      version: config.version || '',
      categories: Object.entries(config.categories || {}).map(([name, details]: [string, any]) => ({
        name,
        dir: details.dir || '',
      })),
    };
  }

  /**
   * Ensure the default category exists
   * Creates category if it doesn't exist
   */
  async ensureCategory(downloadPath?: string): Promise<void> {
    try {
      const config = await this.getConfig();
      const categoryExists = config.categories.some(cat => cat.name === this.defaultCategory);

      if (!categoryExists) {
        console.log(`[SABnzbd] Creating category: ${this.defaultCategory}`);

        // Create category
        await this.client.get('/api', {
          params: {
            mode: 'set_config',
            section: 'categories',
            keyword: this.defaultCategory,
            value: downloadPath || '',
            output: 'json',
            apikey: this.apiKey,
          },
        });

        console.log(`[SABnzbd] Category created successfully: ${this.defaultCategory}`);
      } else {
        console.log(`[SABnzbd] Category already exists: ${this.defaultCategory}`);
      }
    } catch (error) {
      console.error('[SABnzbd] Failed to ensure category:', error);
      // Don't throw - category creation failure shouldn't block downloads
    }
  }

  /**
   * Add NZB by URL
   * Returns the NZB ID
   */
  async addNZB(url: string, options?: AddNZBOptions): Promise<string> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'addurl',
        name: url,
        cat: options?.category || this.defaultCategory,
        priority: this.mapPriority(options?.priority),
        pp: '3', // Post-processing: +Repair, +Unpack, +Delete
        output: 'json',
        apikey: this.apiKey,
      },
    });

    if (response.data?.status === false) {
      throw new Error(response.data.error || 'Failed to add NZB');
    }

    const nzbIds = response.data?.nzo_ids;
    if (!nzbIds || nzbIds.length === 0) {
      throw new Error('SABnzbd did not return an NZB ID');
    }

    const nzbId = nzbIds[0];
    console.log(`[SABnzbd] Added NZB: ${nzbId}`);

    return nzbId;
  }

  /**
   * Get NZB info by ID
   * Checks queue first, then history
   */
  async getNZB(nzbId: string): Promise<NZBInfo | null> {
    // Check queue first
    const queue = await this.getQueue();
    const queueItem = queue.find(item => item.nzbId === nzbId);

    if (queueItem) {
      return this.mapQueueItemToNZBInfo(queueItem);
    }

    // Not in queue, check history
    const history = await this.getHistory(100);
    const historyItem = history.find(item => item.nzbId === nzbId);

    if (historyItem) {
      return this.mapHistoryItemToNZBInfo(historyItem);
    }

    // Not found
    return null;
  }

  /**
   * Get current download queue
   */
  async getQueue(): Promise<QueueItem[]> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'queue',
        output: 'json',
        apikey: this.apiKey,
      },
    });

    const slots = response.data?.queue?.slots || [];
    return slots.map((slot: any) => ({
      nzbId: slot.nzo_id,
      name: slot.filename,
      size: parseFloat(slot.mb || '0'),
      sizeLeft: parseFloat(slot.mbleft || '0'),
      percentage: parseInt(slot.percentage || '0', 10),
      status: slot.status,
      timeLeft: slot.timeleft || '0:00:00',
      category: slot.cat || '',
      priority: slot.priority || 'Normal',
    }));
  }

  /**
   * Get download history
   */
  async getHistory(limit: number = 100): Promise<HistoryItem[]> {
    const response = await this.client.get('/api', {
      params: {
        mode: 'history',
        limit,
        output: 'json',
        apikey: this.apiKey,
      },
    });

    const slots = response.data?.history?.slots || [];
    return slots.map((slot: any) => ({
      nzbId: slot.nzo_id,
      name: slot.name,
      category: slot.category || '',
      status: slot.status,
      bytes: slot.bytes || '0',
      failMessage: slot.fail_message || '',
      storage: slot.storage || '',
      completedTimestamp: slot.completed || '0',
      downloadTime: slot.download_time || '0',
    }));
  }

  /**
   * Pause NZB download
   */
  async pauseNZB(nzbId: string): Promise<void> {
    await this.client.get('/api', {
      params: {
        mode: 'pause',
        value: nzbId,
        output: 'json',
        apikey: this.apiKey,
      },
    });
  }

  /**
   * Resume NZB download
   */
  async resumeNZB(nzbId: string): Promise<void> {
    await this.client.get('/api', {
      params: {
        mode: 'resume',
        value: nzbId,
        output: 'json',
        apikey: this.apiKey,
      },
    });
  }

  /**
   * Delete NZB download
   */
  async deleteNZB(nzbId: string, deleteFiles: boolean = false): Promise<void> {
    await this.client.get('/api', {
      params: {
        mode: 'queue',
        name: 'delete',
        value: nzbId,
        del_files: deleteFiles ? '1' : '0',
        output: 'json',
        apikey: this.apiKey,
      },
    });
  }

  /**
   * Get download progress from queue item
   */
  getDownloadProgress(queueItem: QueueItem): DownloadProgress {
    const bytesTotal = queueItem.size * 1024 * 1024; // Convert MB to bytes
    const bytesLeft = queueItem.sizeLeft * 1024 * 1024;
    const bytesDownloaded = bytesTotal - bytesLeft;
    const percent = queueItem.percentage / 100; // Convert 0-100 to 0.0-1.0

    // Parse time left (format: "0:15:30")
    let etaSeconds = 0;
    if (queueItem.timeLeft && queueItem.timeLeft !== '0:00:00') {
      const parts = queueItem.timeLeft.split(':');
      if (parts.length === 3) {
        etaSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
      }
    }

    // Calculate speed (bytes/sec)
    const speed = etaSeconds > 0 ? bytesLeft / etaSeconds : 0;

    // Map SABnzbd status to our state format
    let state = 'downloading';
    const statusLower = queueItem.status.toLowerCase();
    if (statusLower.includes('paused')) {
      state = 'paused';
    } else if (statusLower.includes('queued')) {
      state = 'queued';
    } else if (statusLower.includes('extracting') || statusLower.includes('unpacking')) {
      state = 'extracting';
    } else if (statusLower.includes('repairing') || statusLower.includes('verifying')) {
      state = 'repairing';
    } else if (percent >= 1.0) {
      state = 'completed';
    }

    return {
      percent: Math.min(percent, 1.0),
      bytesDownloaded,
      bytesTotal,
      speed,
      eta: etaSeconds,
      state,
    };
  }

  /**
   * Map queue item to NZBInfo
   */
  private mapQueueItemToNZBInfo(queueItem: QueueItem): NZBInfo {
    const progress = this.getDownloadProgress(queueItem);
    return {
      nzbId: queueItem.nzbId,
      name: queueItem.name,
      size: queueItem.size * 1024 * 1024, // MB to bytes
      progress: progress.percent,
      status: progress.state as NZBStatus,
      downloadSpeed: progress.speed,
      timeLeft: progress.eta,
      category: queueItem.category,
    };
  }

  /**
   * Map history item to NZBInfo
   */
  private mapHistoryItemToNZBInfo(historyItem: HistoryItem): NZBInfo {
    const isCompleted = historyItem.status.toLowerCase().includes('completed');
    const isFailed = historyItem.status.toLowerCase().includes('failed');

    return {
      nzbId: historyItem.nzbId,
      name: historyItem.name,
      size: parseInt(historyItem.bytes || '0', 10),
      progress: isCompleted ? 1.0 : 0.0,
      status: isFailed ? 'failed' : isCompleted ? 'completed' : 'downloading',
      downloadSpeed: 0,
      timeLeft: 0,
      category: historyItem.category,
      downloadPath: historyItem.storage,
      completedAt: historyItem.completedTimestamp ? new Date(parseInt(historyItem.completedTimestamp) * 1000) : undefined,
      errorMessage: historyItem.failMessage || undefined,
    };
  }

  /**
   * Map priority option to SABnzbd priority value
   */
  private mapPriority(priority?: 'low' | 'normal' | 'high' | 'force'): string {
    switch (priority) {
      case 'force':
        return '2'; // Force (highest)
      case 'high':
        return '1'; // High
      case 'low':
        return '-1'; // Low
      case 'normal':
      default:
        return '0'; // Normal
    }
  }
}

/**
 * Singleton instance and factory
 */
let sabnzbdServiceInstance: SABnzbdService | null = null;

export async function getSABnzbdService(): Promise<SABnzbdService> {
  if (sabnzbdServiceInstance) {
    return sabnzbdServiceInstance;
  }

  // Load configuration from database
  const { getConfigService } = await import('../services/config.service');
  const config = await getConfigService();

  const url = await config.get('download_client_url');
  const apiKey = await config.get('download_client_password'); // Reuse password field for API key
  const category = (await config.get('sabnzbd_category')) || 'readmeabook';
  const disableSSL = ((await config.get('download_client_disable_ssl_verify')) || 'false') === 'true';

  if (!url) {
    throw new Error('SABnzbd URL not configured. Please configure download client settings.');
  }

  if (!apiKey) {
    throw new Error('SABnzbd API key not configured. Please configure download client settings.');
  }

  sabnzbdServiceInstance = new SABnzbdService(url, apiKey, category, disableSSL);

  // Ensure category exists
  const downloadDir = await config.get('download_dir');
  await sabnzbdServiceInstance.ensureCategory(downloadDir || undefined);

  return sabnzbdServiceInstance;
}

export function invalidateSABnzbdService(): void {
  sabnzbdServiceInstance = null;
  console.log('[SABnzbd] Service singleton invalidated');
}
