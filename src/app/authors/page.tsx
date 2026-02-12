/**
 * Component: Authors Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { AuthorGrid } from '@/components/authors/AuthorGrid';
import { useAuthorSearch } from '@/lib/hooks/useAuthors';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CardSizeControls } from '@/components/ui/CardSizeControls';
import { usePreferences } from '@/contexts/PreferencesContext';

function AuthorsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const { cardSize, setCardSize } = usePreferences();

  // Debounce search query and sync to URL
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      // Update URL without adding history entries
      const trimmed = query.trim();
      if (trimmed) {
        router.replace(`/authors?q=${encodeURIComponent(trimmed)}`, { scroll: false });
      } else {
        router.replace('/authors', { scroll: false });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, router]);

  const { authors, isLoading } = useAuthorSearch(debouncedQuery);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
  }, []);

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

        <main className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
          {/* Page Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">
              Browse Authors
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Search for your favorite audiobook authors
            </p>
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="max-w-3xl mx-auto">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by author name..."
                className="w-full pl-12 pr-12 py-4 text-lg border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </form>

          {/* Results */}
          {debouncedQuery ? (
            <div className="space-y-6">
              {/* Sticky Results Header */}
              <div className="sticky top-14 sm:top-16 z-30 mb-4 sm:mb-6">
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full" />
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                      Authors
                    </h2>
                    {!isLoading && authors.length > 0 && (
                      <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline whitespace-nowrap">
                        ({authors.length} result{authors.length !== 1 ? 's' : ''})
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <CardSizeControls size={cardSize} onSizeChange={setCardSize} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Author Grid */}
              <AuthorGrid
                authors={authors}
                isLoading={!!isLoading}
                emptyMessage={`No authors found for "${debouncedQuery}"`}
                cardSize={cardSize}
              />
            </div>
          ) : (
            /* Empty State */
            <div className="text-center py-16 space-y-4">
              <svg
                className="mx-auto h-16 w-16 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
              <p className="text-xl text-gray-600 dark:text-gray-400">
                Start typing to search for authors
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Search by author name to discover their works
              </p>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default function AuthorsPage() {
  return (
    <Suspense>
      <AuthorsPageContent />
    </Suspense>
  );
}
