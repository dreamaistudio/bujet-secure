import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [visible, setVisible] = useState(true);

  const videoSrc = '/assets/welcome.mp4';

  useEffect(() => {
    const timeout = setTimeout(() => {
      console.warn('Splash screen video load timeout fallback triggered');
      onComplete();
    }, 3000);
    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      style={{ display: visible ? 'flex' : 'none' }}
    >
      <video
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'  // scale to frame size
        }}
        onError={(e) => {
          console.error('Video error:', e);
          onComplete(); // skip video if error
        }}
        onEnded={() => {
          setVisible(false);
          onComplete();
        }}
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
    </div>
  );
}
