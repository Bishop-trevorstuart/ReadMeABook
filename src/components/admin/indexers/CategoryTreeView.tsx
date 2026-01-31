/**
 * Component: Category Tree View with Toggle Switches
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import {
  TORRENT_CATEGORIES,
  getChildIds,
  areAllChildrenSelected,
  isParentCategory,
} from '@/lib/utils/torrent-categories';

interface CategoryTreeViewProps {
  selectedCategories: number[];
  onChange: (categories: number[]) => void;
  defaultCategories?: number[]; // Categories to show "Default" badge for (e.g., [3030] for audiobook, [7020] for ebook)
}

export function CategoryTreeView({
  selectedCategories,
  onChange,
  defaultCategories = [3030], // Default to audiobook category for backwards compatibility
}: CategoryTreeViewProps) {
  const isDefaultCategory = (categoryId: number) => defaultCategories.includes(categoryId);
  const handleParentToggle = (parentId: number) => {
    const childIds = getChildIds(parentId);
    const allChildrenSelected = areAllChildrenSelected(parentId, selectedCategories);

    if (allChildrenSelected) {
      // Deselect parent and all children
      onChange(
        selectedCategories.filter(
          (id) => id !== parentId && !childIds.includes(id)
        )
      );
    } else {
      // Select parent and all children
      const newSelection = new Set(selectedCategories);
      newSelection.add(parentId);
      childIds.forEach((id) => newSelection.add(id));
      onChange(Array.from(newSelection));
    }
  };

  const handleChildToggle = (childId: number) => {
    const isSelected = selectedCategories.includes(childId);

    if (isSelected) {
      // Deselect child
      onChange(selectedCategories.filter((id) => id !== childId));
    } else {
      // Select child
      onChange([...selectedCategories, childId]);
    }
  };

  const isParentSelected = (parentId: number) => {
    return areAllChildrenSelected(parentId, selectedCategories);
  };

  const isChildSelected = (childId: number) => {
    return selectedCategories.includes(childId);
  };

  return (
    <div className="space-y-5">
      {TORRENT_CATEGORIES.map((category) => (
        <div key={category.id} className="space-y-2">
          {/* Parent Category Header */}
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                {category.name}
              </span>
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
                [{category.id}]
              </span>
              {isDefaultCategory(category.id) && (
                <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                  Default
                </span>
              )}
            </div>
            <ToggleSwitch
              checked={isParentCategory(category.id) ? isParentSelected(category.id) : isChildSelected(category.id)}
              onChange={() => {
                if (isParentCategory(category.id)) {
                  handleParentToggle(category.id);
                } else {
                  handleChildToggle(category.id);
                }
              }}
              disabled={false}
            />
          </div>

          {/* Child Categories */}
          {category.children && category.children.length > 0 && (
            <div className="ml-4 space-y-2">
              {category.children.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {child.name}
                    </span>
                    <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
                      [{child.id}]
                    </span>
                    {isDefaultCategory(child.id) && (
                      <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                        Default
                      </span>
                    )}
                  </div>
                  <ToggleSwitch
                    checked={isChildSelected(child.id)}
                    onChange={() => handleChildToggle(child.id)}
                    disabled={isParentSelected(category.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}

function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800
        ${
          checked
            ? 'bg-blue-600 dark:bg-blue-500'
            : 'bg-gray-200 dark:bg-gray-700'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out shadow-lg
          ${checked ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  );
}
