/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["bcryptjs", "ffmpeg-static"],
    outputFileTracingIncludes: {
      '/api/videos/[id]/transcribe': ['./node_modules/ffmpeg-static/**/*'],
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

export default nextConfig;
