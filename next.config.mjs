import { withWorkflow } from "workflow/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["bcryptjs", "ffmpeg-static"],
    // The transcription pipeline now runs inside the Workflow DevKit step route, so
    // the ffmpeg-static binary must be traced into THAT function on Vercel (the
    // eval("require") trick keeps it external, so Next can't auto-detect it).
    outputFileTracingIncludes: {
      '/api/videos/[id]/transcribe': ['./node_modules/ffmpeg-static/**/*'],
      '/.well-known/workflow/v1/step': ['./node_modules/ffmpeg-static/**/*'],
      '/.well-known/workflow/v1/flow': ['./node_modules/ffmpeg-static/**/*'],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
  },
};

export default withWorkflow(nextConfig);
