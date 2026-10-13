// US highway stock clips (Mixkit free license), pre-cropped to 1080×1920, 30fps.
// Shared with the Balkan Truckers promo project.
export const FOOTAGE = {
  'aerial-traffic': { src: 'footage/aerial-traffic.mp4', frames: 420 },
  'highway-pov': { src: 'footage/highway-pov.mp4', frames: 369 },
  'sunset-drive': { src: 'footage/sunset-drive.mp4', frames: 420 },
  'truck-fog': { src: 'footage/truck-fog.mp4', frames: 420 },
  trucker: { src: 'footage/trucker.mp4', frames: 420 },
} as const;

export type FootageName = keyof typeof FOOTAGE;
