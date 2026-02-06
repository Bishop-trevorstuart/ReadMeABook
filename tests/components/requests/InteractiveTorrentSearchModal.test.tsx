/**
 * Component: Interactive Torrent Search Modal Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const searchByRequestMock = vi.hoisted(() => vi.fn());
const selectTorrentMock = vi.hoisted(() => vi.fn());
const searchByAudiobookMock = vi.hoisted(() => vi.fn());
const requestWithTorrentMock = vi.hoisted(() => vi.fn());
const searchEbooksMock = vi.hoisted(() => vi.fn());
const selectEbookMock = vi.hoisted(() => vi.fn());
const searchEbooksByAsinMock = vi.hoisted(() => vi.fn());
const selectEbookByAsinMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useInteractiveSearch: () => ({
    searchTorrents: searchByRequestMock,
    isLoading: false,
    error: null,
  }),
  useSelectTorrent: () => ({
    selectTorrent: selectTorrentMock,
    isLoading: false,
    error: null,
  }),
  useSearchTorrents: () => ({
    searchTorrents: searchByAudiobookMock,
    isLoading: false,
    error: null,
  }),
  useRequestWithTorrent: () => ({
    requestWithTorrent: requestWithTorrentMock,
    isLoading: false,
    error: null,
  }),
  useInteractiveSearchEbook: () => ({
    searchEbooks: searchEbooksMock,
    isLoading: false,
    error: null,
  }),
  useSelectEbook: () => ({
    selectEbook: selectEbookMock,
    isLoading: false,
    error: null,
  }),
  useInteractiveSearchEbookByAsin: () => ({
    searchEbooks: searchEbooksByAsinMock,
    isLoading: false,
    error: null,
  }),
  useSelectEbookByAsin: () => ({
    selectEbook: selectEbookByAsinMock,
    isLoading: false,
    error: null,
  }),
}));

const baseResult = {
  guid: 'torrent-1',
  rank: 1,
  title: 'Test Torrent',
  size: 2.4 * 1024 ** 3,
  score: 88,
  bonusPoints: 5,
  seeders: 42,
  indexer: 'ProIndexer',
  format: 'M4B',
  infoUrl: 'https://example.com/torrent',
};

describe('InteractiveTorrentSearchModal', () => {
  it('searches by request id on open and confirms download', async () => {
    searchByRequestMock.mockResolvedValueOnce([baseResult]);
    selectTorrentMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

    render(
      <InteractiveTorrentSearchModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        requestId="req-123"
        audiobook={{ title: 'Test Book', author: 'Test Author' }}
      />
    );

    await waitFor(() => {
      expect(searchByRequestMock).toHaveBeenCalledWith('req-123', undefined);
    });

    expect(await screen.findByText('Test Torrent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Get' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(selectTorrentMock).toHaveBeenCalledWith('req-123', baseResult);
    });
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('searches by audiobook data and requests with torrent', async () => {
    searchByAudiobookMock.mockResolvedValueOnce([baseResult]);
    requestWithTorrentMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const fullAudiobook = { asin: 'ASIN-1', title: 'Test Book', author: 'Test Author' };
    const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

    render(
      <InteractiveTorrentSearchModal
        isOpen={true}
        onClose={onClose}
        audiobook={{ title: 'Test Book', author: 'Test Author' }}
        fullAudiobook={fullAudiobook as any}
      />
    );

    await waitFor(() => {
      expect(searchByAudiobookMock).toHaveBeenCalledWith('Test Book', 'Test Author', 'ASIN-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Get' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(requestWithTorrentMock).toHaveBeenCalledWith(fullAudiobook, baseResult);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('uses a custom title when pressing Enter', async () => {
    searchByRequestMock.mockResolvedValueOnce([]);
    searchByRequestMock.mockResolvedValueOnce([]);
    const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

    render(
      <InteractiveTorrentSearchModal
        isOpen={true}
        onClose={vi.fn()}
        requestId="req-456"
        audiobook={{ title: 'Original Title', author: 'Author' }}
      />
    );

    await waitFor(() => {
      expect(searchByRequestMock).toHaveBeenCalledWith('req-456', undefined);
    });

    const input = screen.getByPlaceholderText('Search title...');
    fireEvent.change(input, { target: { value: 'Custom Title' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(searchByRequestMock).toHaveBeenNthCalledWith(2, 'req-456', 'Custom Title');
    });
  });
});
