"use client";

import { useRef, useState } from "react";

export default function DemoVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  function handleTogglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
      return;
    }

    video.pause();
  }

  return (
    <div className="relative mx-auto mb-10 max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="relative aspect-video bg-white">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        >
          <source src="/demo/boq-demo.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>

        {!isPlaying ? (
          <button
            type="button"
            onClick={handleTogglePlayback}
            className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/10"
            aria-label="Play demo video"
          >
            <img
              src="/demo/boq-demo-poster.png"
              alt="BOQ Generator demo preview"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span className="relative z-10 flex h-18 w-18 items-center justify-center rounded-full bg-amber-400 text-black shadow-lg">
              <svg
                className="ml-1 h-7 w-7"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.14v13.72A1 1 0 009.5 19.7l10.2-6.86a1 1 0 000-1.68L9.5 4.3A1 1 0 008 5.14z" />
              </svg>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
