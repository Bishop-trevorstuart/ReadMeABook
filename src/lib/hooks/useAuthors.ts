/**
 * Component: Authors Fetching Hooks
 * Documentation: documentation/frontend/components.md
 */

'use client';

import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/utils/api';
import { Audiobook } from './useAudiobooks';

export interface Author {
  asin: string;
  name: string;
  description?: string;
  image?: string;
  genres: string[];
  similarCount: number;
}

export interface SimilarAuthor {
  asin: string;
  name: string;
  image?: string;
}

export interface AuthorDetail {
  asin: string;
  name: string;
  description?: string;
  image?: string;
  genres: string[];
  similar: SimilarAuthor[];
  audibleUrl?: string;
}

export function useAuthorSearch(name: string) {
  const shouldFetch = name && name.length > 0;
  const endpoint = shouldFetch
    ? `/api/authors/search?name=${encodeURIComponent(name)}`
    : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  return {
    authors: (data?.authors || []) as Author[],
    query: data?.query || '',
    isLoading: shouldFetch && isLoading,
    error,
  };
}

export function useAuthorDetail(asin: string | null) {
  const endpoint = asin ? `/api/authors/${asin}` : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  return {
    author: (data?.author || null) as AuthorDetail | null,
    isLoading,
    error,
  };
}

export function useAuthorBooks(asin: string | null, authorName: string | null) {
  const shouldFetch = asin && authorName;
  const endpoint = shouldFetch
    ? `/api/authors/${asin}/books?name=${encodeURIComponent(authorName)}`
    : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000, // Cache for 1 minute
  });

  return {
    books: (data?.books || []) as Audiobook[],
    totalBooks: data?.totalBooks || 0,
    isLoading: !!shouldFetch && isLoading,
    error,
  };
}
