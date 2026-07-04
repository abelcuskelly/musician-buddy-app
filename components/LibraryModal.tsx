import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { SavedItem, SavedItemType } from '../types.ts';
import { listLibraryItems, deleteLibraryItem } from '../services/library.ts';
import { downloadMarkdown, downloadAudioFromUrl } from '../lib/content.ts';
import CloseIcon from './icons/CloseIcon.tsx';
import DownloadIcon from './icons/DownloadIcon.tsx';
import TrashIcon from './icons/TrashIcon.tsx';
import LibraryIcon from './icons/LibraryIcon.tsx';

interface LibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Filter = 'all' | SavedItemType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'lesson-plan', label: 'Lesson Plans' },
  { id: 'song', label: 'Songs' },
  { id: 'audio', label: 'Audio' },
];

const TYPE_BADGES: Record<SavedItemType, { label: string; className: string }> = {
  'lesson-plan': { label: 'Lesson Plan', className: 'bg-[#89b4fa]/15 text-[#89b4fa]' },
  song: { label: 'Song', className: 'bg-[#a6e3a1]/15 text-[#a6e3a1]' },
  audio: { label: 'Audio', className: 'bg-[#cba6f7]/15 text-[#cba6f7]' },
};

const LibraryModal: React.FC<LibraryModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      setItems(await listLibraryItems(user.uid));
    } catch (e: any) {
      console.error('Failed to load library:', e);
      setError(e.message || 'Failed to load your library.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen && user) {
      loadItems();
    }
  }, [isOpen, user, loadItems]);

  if (!isOpen) return null;

  const handleDelete = async (item: SavedItem) => {
    if (!user) return;
    if (!window.confirm(`Delete "${item.title}" from your library?`)) return;
    try {
      await deleteLibraryItem(user.uid, item);
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e: any) {
      console.error('Failed to delete item:', e);
      setError(e.message || 'Failed to delete the item.');
    }
  };

  const handleDownload = (item: SavedItem) => {
    if (item.type === 'audio' && item.audioUrl) {
      downloadAudioFromUrl(item.audioUrl, item.title);
    } else {
      downloadMarkdown(item.title, item.content);
    }
  };

  const visibleItems = filter === 'all' ? items : items.filter(item => item.type === filter);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      aria-modal="true"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="bg-[#1e1e2e] rounded-2xl shadow-lg w-full max-w-2xl border border-gray-700/50 animate-fade-in flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-700/50 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-[#cba6f7] to-[#f5c2e7] rounded-lg">
              <LibraryIcon className="w-5 h-5 text-gray-900" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#cdd6f4]">My Library</h2>
              <p className="text-sm text-gray-400">Your saved lesson plans, songs, and audio clips.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors"
            aria-label="Close library"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 flex gap-2">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === id ? 'bg-[#89b4fa] text-gray-900' : 'bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-3 overflow-y-auto flex-1">
          {error && <p className="text-sm text-red-400">{error}</p>}

          {isLoading ? (
            <p className="text-gray-400 text-center py-8">Loading your library...</p>
          ) : visibleItems.length === 0 ? (
            <p className="text-gray-400 text-center py-8">
              Nothing saved here yet. Generate a lesson plan or song, then hit "Save to Profile".
            </p>
          ) : (
            visibleItems.map(item => {
              const badge = TYPE_BADGES[item.type];
              const isExpanded = expandedId === item.id;
              return (
                <div key={item.id} className="bg-[#181825] border border-gray-700/50 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      className="flex-1 text-left min-w-0"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(item.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="text-[#cdd6f4] font-medium mt-1 truncate">{item.title}</p>
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleDownload(item)}
                        className="p-2 rounded-full hover:bg-white/10 text-[#89b4fa] transition-colors"
                        aria-label={`Download ${item.title}`}
                        title="Download"
                      >
                        <DownloadIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="p-2 rounded-full hover:bg-red-500/20 text-red-400 transition-colors"
                        aria-label={`Delete ${item.title}`}
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {item.type === 'audio' && item.audioUrl && (
                    <audio controls className="w-full h-10 mt-3">
                      <source src={item.audioUrl} type="audio/mp3" />
                      Your browser does not support the audio element.
                    </audio>
                  )}

                  {isExpanded && item.content && (
                    <pre className="mt-3 p-3 bg-[#11111b] rounded-lg text-sm text-[#cdd6f4] whitespace-pre-wrap font-sans max-h-64 overflow-y-auto border border-gray-700/40">
                      {item.content}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryModal;
