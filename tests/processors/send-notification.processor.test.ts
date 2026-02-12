/**
 * Component: Send Notification Processor Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEvent } from '@/lib/constants/notification-events';

const notificationServiceMock = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

vi.mock('@/lib/services/notification', () => ({
  getNotificationService: () => notificationServiceMock,
}));

describe('processSendNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls notification service with correct payload', async () => {
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');

    const payload = {
      event: 'request_approved' as const,
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      jobId: 'job-1',
    };

    await processSendNotification(payload);

    expect(notificationServiceMock.sendNotification).toHaveBeenCalledWith({
      event: 'request_approved',
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      timestamp: expect.any(Date),
    });
  });

  it('includes error message if provided', async () => {
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');

    const payload = {
      event: 'request_error' as const,
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      message: 'Download failed',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      jobId: 'job-1',
    };

    await processSendNotification(payload);

    expect(notificationServiceMock.sendNotification).toHaveBeenCalledWith({
      event: 'request_error',
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      message: 'Download failed',
      timestamp: expect.any(Date),
    });
  });

  it('forwards requestType to notification service', async () => {
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');

    const payload = {
      event: 'request_available' as const,
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      requestType: 'ebook',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      jobId: 'job-1',
    };

    await processSendNotification(payload);

    expect(notificationServiceMock.sendNotification).toHaveBeenCalledWith({
      event: 'request_available',
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      requestType: 'ebook',
      timestamp: expect.any(Date),
    });
  });

  it('does not throw if notification service fails', async () => {
    notificationServiceMock.sendNotification.mockRejectedValue(new Error('Service error'));

    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');

    const payload = {
      event: 'request_approved' as const,
      requestId: 'req-1',
      title: 'Test Book',
      author: 'Test Author',
      userName: 'Test User',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      jobId: 'job-1',
    };

    // Should not throw
    await expect(processSendNotification(payload)).resolves.toBeUndefined();
  });

  it('processes all event types correctly', async () => {
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');

    const events: NotificationEvent[] = [
      'request_pending_approval',
      'request_approved',
      'request_available',
      'request_error',
    ];

    for (const event of events) {
      const payload = {
        event,
        requestId: 'req-1',
        title: 'Test Book',
        author: 'Test Author',
        userName: 'Test User',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        jobId: 'job-1',
      };

      await processSendNotification(payload);
    }

    expect(notificationServiceMock.sendNotification).toHaveBeenCalledTimes(4);
  });
});
