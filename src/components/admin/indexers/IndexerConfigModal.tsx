/**
 * Component: Indexer Configuration Modal
 * Documentation: documentation/frontend/components.md
 *
 * Supports separate category configurations for AudioBook and EBook searches
 * via tabbed interface in the Categories section.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CategoryTreeView } from './CategoryTreeView';
import { DEFAULT_AUDIOBOOK_CATEGORIES, DEFAULT_EBOOK_CATEGORIES } from '@/lib/utils/torrent-categories';

type CategoryTab = 'audiobook' | 'ebook';

interface IndexerConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  indexer: {
    id: number;
    name: string;
    protocol: string;
    supportsRss: boolean;
  };
  initialConfig?: {
    priority: number;
    seedingTimeMinutes?: number;
    removeAfterProcessing?: boolean;
    rssEnabled: boolean;
    audiobookCategories: number[];
    ebookCategories: number[];
  };
  onSave: (config: {
    id: number;
    name: string;
    protocol: string;
    priority: number;
    seedingTimeMinutes?: number;
    removeAfterProcessing?: boolean;
    rssEnabled: boolean;
    audiobookCategories: number[];
    ebookCategories: number[];
  }) => void;
}

export function IndexerConfigModal({
  isOpen,
  onClose,
  mode,
  indexer,
  initialConfig,
  onSave,
}: IndexerConfigModalProps) {
  // Default values for Add mode
  const isTorrent = indexer.protocol?.toLowerCase() === 'torrent';
  const defaults = {
    priority: 10,
    seedingTimeMinutes: 0,
    removeAfterProcessing: true, // Default to true for Usenet
    rssEnabled: indexer.supportsRss,
    audiobookCategories: DEFAULT_AUDIOBOOK_CATEGORIES,
    ebookCategories: DEFAULT_EBOOK_CATEGORIES,
  };

  // Form state
  const [priority, setPriority] = useState(
    initialConfig?.priority ?? defaults.priority
  );
  const [seedingTimeMinutes, setSeedingTimeMinutes] = useState(
    initialConfig?.seedingTimeMinutes ?? defaults.seedingTimeMinutes
  );
  const [removeAfterProcessing, setRemoveAfterProcessing] = useState(
    initialConfig?.removeAfterProcessing ?? defaults.removeAfterProcessing
  );
  const [rssEnabled, setRssEnabled] = useState(
    initialConfig?.rssEnabled ?? defaults.rssEnabled
  );

  // Dual category state
  const [audiobookCategories, setAudiobookCategories] = useState<number[]>(
    initialConfig?.audiobookCategories ?? defaults.audiobookCategories
  );
  const [ebookCategories, setEbookCategories] = useState<number[]>(
    initialConfig?.ebookCategories ?? defaults.ebookCategories
  );

  // Tab state for categories
  const [activeTab, setActiveTab] = useState<CategoryTab>('audiobook');

  // Validation errors
  const [errors, setErrors] = useState<{
    priority?: string;
    seedingTimeMinutes?: string;
    audiobookCategories?: string;
    ebookCategories?: string;
  }>({});

  // Reset form when modal opens or indexer changes
  useEffect(() => {
    if (isOpen) {
      if (mode === 'add') {
        setPriority(defaults.priority);
        setSeedingTimeMinutes(defaults.seedingTimeMinutes);
        setRemoveAfterProcessing(defaults.removeAfterProcessing);
        setRssEnabled(defaults.rssEnabled);
        setAudiobookCategories(defaults.audiobookCategories);
        setEbookCategories(defaults.ebookCategories);
      } else {
        setPriority(initialConfig?.priority ?? defaults.priority);
        setSeedingTimeMinutes(initialConfig?.seedingTimeMinutes ?? defaults.seedingTimeMinutes);
        setRemoveAfterProcessing(initialConfig?.removeAfterProcessing ?? defaults.removeAfterProcessing);
        setRssEnabled(initialConfig?.rssEnabled ?? defaults.rssEnabled);
        setAudiobookCategories(initialConfig?.audiobookCategories ?? defaults.audiobookCategories);
        setEbookCategories(initialConfig?.ebookCategories ?? defaults.ebookCategories);
      }
      setActiveTab('audiobook');
      setErrors({});
    }
  }, [isOpen, mode, indexer.id]);

  const validate = () => {
    const newErrors: typeof errors = {};

    if (priority < 1 || priority > 25) {
      newErrors.priority = 'Priority must be between 1 and 25';
    }

    if (isTorrent && seedingTimeMinutes < 0) {
      newErrors.seedingTimeMinutes = 'Seeding time cannot be negative';
    }

    if (audiobookCategories.length === 0) {
      newErrors.audiobookCategories = 'At least one audiobook category must be selected';
    }

    if (ebookCategories.length === 0) {
      newErrors.ebookCategories = 'At least one ebook category must be selected';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) {
      // If there's a category error, switch to the relevant tab
      if (errors.audiobookCategories && activeTab !== 'audiobook') {
        setActiveTab('audiobook');
      } else if (errors.ebookCategories && activeTab !== 'ebook') {
        setActiveTab('ebook');
      }
      return;
    }

    const config: any = {
      id: indexer.id,
      name: indexer.name,
      protocol: indexer.protocol,
      priority,
      rssEnabled: indexer.supportsRss ? rssEnabled : false,
      audiobookCategories,
      ebookCategories,
    };

    // Add protocol-specific fields
    if (isTorrent) {
      config.seedingTimeMinutes = seedingTimeMinutes;
    } else {
      config.removeAfterProcessing = removeAfterProcessing;
    }

    onSave(config);
    onClose();
  };

  const handlePriorityChange = (value: string) => {
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      // Clamp value between 1 and 25
      setPriority(Math.max(1, Math.min(25, parsed)));
    } else if (value === '') {
      setPriority(1);
    }
  };

  const handleSeedingTimeChange = (value: string) => {
    if (value === '') {
      setSeedingTimeMinutes(0);
    } else {
      const parsed = parseInt(value);
      if (!isNaN(parsed)) {
        setSeedingTimeMinutes(Math.max(0, parsed));
      }
    }
  };

  // Get the current categories based on active tab
  const currentCategories = activeTab === 'audiobook' ? audiobookCategories : ebookCategories;
  const setCurrentCategories = activeTab === 'audiobook' ? setAudiobookCategories : setEbookCategories;
  const currentError = activeTab === 'audiobook' ? errors.audiobookCategories : errors.ebookCategories;
  const defaultForTab = activeTab === 'audiobook' ? DEFAULT_AUDIOBOOK_CATEGORIES : DEFAULT_EBOOK_CATEGORIES;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'add' ? 'Add Indexer' : 'Edit Indexer'}
      size="md"
    >
      <div className="space-y-6">
        {/* Indexer Info (readonly) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Indexer
          </label>
          <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <span className="text-base font-medium text-gray-900 dark:text-gray-100">
              {indexer.name}
            </span>
            <span className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
              {indexer.protocol}
            </span>
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Priority (1-25)
          </label>
          <Input
            type="number"
            min="1"
            max="25"
            value={priority}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className={errors.priority ? 'border-red-500' : ''}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Higher values = preferred in ranking algorithm
          </p>
          {errors.priority && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {errors.priority}
            </p>
          )}
        </div>

        {/* Seeding Time (Torrents only) */}
        {isTorrent && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Seeding Time (minutes)
            </label>
            <Input
              type="number"
              min="0"
              step="1"
              value={seedingTimeMinutes}
              onChange={(e) => handleSeedingTimeChange(e.target.value)}
              placeholder="0"
              className={errors.seedingTimeMinutes ? 'border-red-500' : ''}
            />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              0 = unlimited seeding (files remain seeded indefinitely)
            </p>
            {errors.seedingTimeMinutes && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {errors.seedingTimeMinutes}
              </p>
            )}
          </div>
        )}

        {/* Remove After Processing (Usenet only) */}
        {!isTorrent && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Post-Processing Cleanup
            </label>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={removeAfterProcessing}
                onChange={(e) => setRemoveAfterProcessing(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Remove download from SABnzbd after files are organized
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Recommended: Automatically deletes completed NZB downloads to save disk space
            </p>
          </div>
        )}

        {/* RSS Monitoring */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            RSS Monitoring
          </label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={rssEnabled}
              onChange={(e) => setRssEnabled(e.target.checked)}
              disabled={!indexer.supportsRss}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Auto-check RSS feeds every 15 minutes
            </span>
          </div>
          {!indexer.supportsRss && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
              This indexer does not support RSS monitoring
            </p>
          )}
        </div>

        {/* Categories with Tabs */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Categories
          </label>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
            <button
              type="button"
              onClick={() => setActiveTab('audiobook')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'audiobook'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              AudioBook
              {errors.audiobookCategories && (
                <span className="ml-2 text-red-500">!</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ebook')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'ebook'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              EBook
              {errors.ebookCategories && (
                <span className="ml-2 text-red-500">!</span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="max-h-72 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <CategoryTreeView
              selectedCategories={currentCategories}
              onChange={setCurrentCategories}
              defaultCategories={defaultForTab}
            />
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {activeTab === 'audiobook'
              ? 'Categories to search for audiobooks. Default: Audio/Audiobook [3030]'
              : 'Categories to search for e-books. Default: Books/EBook [7020]'}
          </p>

          {currentError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {currentError}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button onClick={handleSave} variant="primary">
            {mode === 'add' ? 'Add Indexer' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
