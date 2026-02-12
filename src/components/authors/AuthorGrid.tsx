/**
 * Component: Author Grid
 * Documentation: documentation/frontend/components.md
 *
 * Premium grid layout for author cards with loading skeletons and empty state.
 * Mirrors AudiobookGrid patterns with author-appropriate column counts.
 */

'use client';

import React from 'react';
import { AuthorCard } from './AuthorCard';
import { Author } from '@/lib/hooks/useAuthors';

interface AuthorGridProps {
  authors: Author[];
  isLoading?: boolean;
  emptyMessage?: string;
  cardSize?: number;
}

// Authors use wider spacing since circular portraits need room to breathe.
// Slightly fewer columns than AudiobookGrid at each breakpoint since circles
// are visually wider than 2:3 portrait covers.
function getGridClasses(size: number): string {
  const sizeMap: Record<number, string> = {
    1: 'grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9',
    2: 'grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
    3: 'grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7',
    4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
    5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    7: 'grid-cols-2 md:grid-cols-3',
    8: 'grid-cols-2',
    9: 'grid-cols-1',
  };
  return sizeMap[size] || sizeMap[5];
}

export function AuthorGrid({
  authors,
  isLoading = false,
  emptyMessage = 'No authors found',
  cardSize = 5,
}: AuthorGridProps) {
  const gridClasses = getGridClasses(cardSize);

  if (isLoading) {
    return (
      <div className={`grid ${gridClasses} gap-5 sm:gap-6 lg:gap-8`}>
        {Array.from({ length: 10 }).map((_, i) => (
          <AuthorSkeletonCard key={i} index={i} />
        ))}
      </div>
    );
  }

  if (authors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridClasses} gap-5 sm:gap-6 lg:gap-8`}>
      {authors.map(author => (
        <AuthorCard key={author.asin} author={author} />
      ))}
    </div>
  );
}

function AuthorSkeletonCard({ index = 0 }: { index?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Circular portrait skeleton */}
      <div className="flex justify-center">
        <div className="relative overflow-hidden rounded-full w-full aspect-square bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>
      </div>

      {/* Text skeleton */}
      <div className="mt-3 px-1 flex flex-col items-center space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-lg w-4/5" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-lg w-3/5" />
      </div>
    </div>
  );
}
