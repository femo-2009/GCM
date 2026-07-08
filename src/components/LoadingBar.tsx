import React from 'react';
import { useLoading } from '../lib/LoadingContext';

export default function LoadingBar() {
  const { isLoading } = useLoading();

  return (
    <div
      className={`fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-400 to-purple-500 z-50 transition-opacity duration-300 ${isLoading ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Optional: Add a subtle animation when loading */}
      {isLoading && (
        <div className="animate-progress-bar absolute inset-0 bg-white opacity-25"></div>
      )}
    </div>
  );
}
