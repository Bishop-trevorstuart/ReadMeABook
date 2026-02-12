/**
 * Component: Similar Authors Row
 * Documentation: documentation/frontend/components.md
 *
 * Horizontal scrollable carousel of similar author cards.
 * Desktop: left/right nav arrows. Mobile: drag-to-scroll.
 * Each card navigates to the author's detail page.
 */

'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SimilarAuthor } from '@/lib/hooks/useAuthors';

interface SimilarAuthorsRowProps {
  authors: SimilarAuthor[];
  currentAuthorName?: string;
}

export function SimilarAuthorsRow({ authors, currentAuthorName }: SimilarAuthorsRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      observer.disconnect();
    };
  }, [checkScroll, authors]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.7;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (authors.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-1 h-6 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full" />
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          Similar Authors
        </h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          ({authors.length})
        </span>
      </div>

      <div className="relative group">
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 w-10 h-10 bg-white dark:bg-gray-800 rounded-full shadow-lg items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all opacity-0 group-hover:opacity-100"
            aria-label="Scroll left"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Scrollable row */}
        <div
          ref={scrollRef}
          className="flex gap-4 sm:gap-5 overflow-x-auto scrollbar-hide pb-2 scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {authors.map(author => (
            <Link
              key={author.asin}
              href={`/authors/${author.asin}${currentAuthorName ? `?from=${encodeURIComponent(currentAuthorName)}` : ''}`}
              className="flex-shrink-0 w-24 sm:w-28 group/card outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
            >
              {/* Circular portrait */}
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden shadow-md shadow-black/15 dark:shadow-black/30 group-hover/card:shadow-lg group-hover/card:scale-[1.04] group-hover/card:-translate-y-0.5 transition-all duration-300">
                {author.image ? (
                  <Image
                    src={author.image}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="112px"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900 dark:to-indigo-900 flex items-center justify-center">
                    <span className="text-xl font-bold text-blue-400 dark:text-blue-300">
                      {author.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              {/* Name */}
              <p className="mt-2 text-xs sm:text-sm font-medium text-center text-gray-700 dark:text-gray-300 line-clamp-2 group-hover/card:text-indigo-600 dark:group-hover/card:text-indigo-400 transition-colors">
                {author.name}
              </p>
            </Link>
          ))}
        </div>

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 w-10 h-10 bg-white dark:bg-gray-800 rounded-full shadow-lg items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all opacity-0 group-hover:opacity-100"
            aria-label="Scroll right"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Fade edges */}
        {canScrollLeft && (
          <div className="hidden md:block absolute left-0 top-0 bottom-2 w-8 bg-gradient-to-r from-white dark:from-gray-900 to-transparent pointer-events-none z-[5]" />
        )}
        {canScrollRight && (
          <div className="hidden md:block absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-white dark:from-gray-900 to-transparent pointer-events-none z-[5]" />
        )}
      </div>
    </div>
  );
}

export function SimilarAuthorsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-1 h-6 bg-gray-300 dark:bg-gray-600 rounded-full" />
        <div className="h-7 w-40 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
      <div className="flex gap-4 sm:gap-5 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-24 sm:w-28" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 relative overflow-hidden">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
            <div className="mt-2 h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/5 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
