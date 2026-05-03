export default function WatchLoading() {
  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start animate-pulse">

        {/* Left: video + info */}
        <div className="flex-1 min-w-0">
          {/* Video placeholder */}
          <div className="w-full aspect-video bg-yt-surface rounded-xl" />
          {/* Timeline */}
          <div className="mt-2 h-1.5 bg-yt-surface rounded-full" />
          {/* Phase legend */}
          <div className="mt-1.5 flex gap-4">
            <div className="h-3 w-16 bg-yt-surface rounded" />
            <div className="h-3 w-14 bg-yt-surface rounded" />
            <div className="h-3 w-18 bg-yt-surface rounded" />
          </div>
          {/* Title */}
          <div className="mt-4 h-7 w-3/4 bg-yt-surface rounded-lg" />
          {/* Stats row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-3 pb-4 border-b border-yt-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yt-surface shrink-0" />
              <div className="h-4 w-28 bg-yt-surface rounded" />
            </div>
            <div className="flex items-center gap-4">
              <div className="h-4 w-20 bg-yt-surface rounded" />
              <div className="h-4 w-16 bg-yt-surface rounded" />
              <div className="h-8 w-20 bg-yt-surface rounded-full" />
            </div>
          </div>
          {/* Description */}
          <div className="mt-4 h-20 bg-yt-surface rounded-xl" />
        </div>

        {/* Right: chapters panel */}
        <div className="lg:w-[360px] xl:w-[400px] shrink-0 w-full">
          {/* Header */}
          <div className="h-6 w-28 bg-yt-surface rounded mb-1" />
          <div className="h-3.5 w-44 bg-yt-surface rounded mb-4" />
          {/* Filter chips */}
          <div className="flex gap-2 mb-3">
            {[40, 60, 52, 70].map((w) => (
              <div key={w} className="h-6 rounded-full bg-yt-surface" style={{ width: w }} />
            ))}
          </div>
          {/* Chapter cards grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-yt-border">
                <div className="aspect-video bg-yt-surface" />
                <div className="p-2.5 space-y-1.5">
                  <div className="h-3 w-full bg-yt-surface rounded" />
                  <div className="h-3 w-2/3 bg-yt-surface rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
