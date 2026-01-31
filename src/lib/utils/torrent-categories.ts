/**
 * Predefined Torrent Category Tree
 * Documentation: documentation/phase3/prowlarr.md
 */

export interface TorrentCategory {
  id: number;
  name: string;
  children?: TorrentCategory[];
}

export const TORRENT_CATEGORIES: TorrentCategory[] = [
  {
    id: 3000,
    name: 'Audio',
    children: [
      { id: 3010, name: 'MP3' },
      { id: 3030, name: 'Audiobook' },
      { id: 3040, name: 'Lossless' },
      { id: 3050, name: 'Other' },
      { id: 3060, name: 'Foreign' },
    ],
  },
  {
    id: 7000,
    name: 'Books',
    children: [
      { id: 7020, name: 'EBook' },
      { id: 7050, name: 'Other' },
      { id: 7060, name: 'Foreign' },
    ],
  },
  {
    id: 8000,
    name: 'Other',
  },
];

export const DEFAULT_AUDIOBOOK_CATEGORIES = [3030]; // Audio/Audiobook
export const DEFAULT_EBOOK_CATEGORIES = [7020]; // Books/EBook

// Legacy alias for backwards compatibility
export const DEFAULT_CATEGORIES = DEFAULT_AUDIOBOOK_CATEGORIES;

/**
 * Get all child IDs for a parent category
 */
export function getChildIds(parentId: number): number[] {
  const parent = TORRENT_CATEGORIES.find((cat) => cat.id === parentId);
  return parent?.children?.map((child) => child.id) || [];
}

/**
 * Get parent ID for a child category
 */
export function getParentId(childId: number): number | null {
  for (const parent of TORRENT_CATEGORIES) {
    if (parent.children?.some((child) => child.id === childId)) {
      return parent.id;
    }
  }
  return null;
}

/**
 * Check if all children of a parent are selected
 */
export function areAllChildrenSelected(
  parentId: number,
  selectedIds: number[]
): boolean {
  const childIds = getChildIds(parentId);
  return childIds.length > 0 && childIds.every((id) => selectedIds.includes(id));
}

/**
 * Check if a category is a parent (has children)
 */
export function isParentCategory(categoryId: number): boolean {
  const category = TORRENT_CATEGORIES.find((cat) => cat.id === categoryId);
  return !!category?.children && category.children.length > 0;
}
