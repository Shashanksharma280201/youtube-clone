export default function WatchLoading() {
  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Left: video + info */}
        <div className="flex-1 min-w-0">
          <div className="w-full aspect-video rounded-2xl shimmer border border-slate-200" />
          <div className="mt-2.5 h-1.5 rounded-full shimmer" />
          <div className="mt-4 h-7 w-3/4 rounded-xl shimmer" />
          <div className="flex items-center gap-3 mt-3 pb-4 border-b border-yt-border">
            <div className="w-10 h-10 rounded-xl shimmer shrink-0" />
            <div className="space-y-2">
              <div className="h-4 w-28 rounded-lg shimmer" />
              <div className="h-3 w-20 rounded shimmer" />
            </div>
          </div>
          <div className="mt-4 h-20 rounded-2xl shimmer" />
        </div>

        {/* Right: chapters panel */}
        <div className="lg:w-[360px] xl:w-[400px] shrink-0 w-full">
          <div className="h-9 rounded-xl shimmer mb-3" />
          <div className="h-6 w-28 rounded-lg shimmer mb-1" />
          <div className="h-3.5 w-44 rounded shimmer mb-4" />
          <div className="flex gap-2 mb-3">
            {[40, 60, 52, 70].map((w) => (
              <div key={w} className="h-6 rounded-lg shimmer" style={{ width: w }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-slate-200 bg-white shadow-card">
                <div className="aspect-video shimmer" />
                <div className="p-2.5 space-y-1.5">
                  <div className="h-3 rounded shimmer" />
                  <div className="h-3 w-2/3 rounded shimmer" />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
