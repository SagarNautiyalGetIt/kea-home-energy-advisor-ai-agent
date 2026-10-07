import { Asset } from 'expo-asset';
import { useEffect } from 'react';
import { HOME_NATURE_VOLUME } from '@/lib/home-ambience';
import { useActiveAnimation } from '@/lib/use-active-animation';

const garden = require('../../assets/audio/home-garden.m4a');
const breeze = require('../../assets/audio/home-breeze.m4a');

/** Browser playback waits safely for a gesture when autoplay is restricted. */
export function HomeNatureSound({ birds }: { birds: boolean }) {
  const active = useActiveAnimation();
  useEffect(() => {
    if (!active) return;
    const audio = new Audio(Asset.fromModule(birds ? garden : breeze).uri);
    audio.loop = true;
    audio.volume = HOME_NATURE_VOLUME;
    let current = true;
    const removeGestures = () => {
      document.removeEventListener('pointerdown', play);
      document.removeEventListener('keydown', play);
    };
    const play = () => {
      if (!current) return;
      void audio.play().then(() => {
        if (!current) audio.pause();
        else removeGestures();
      }).catch(() => { /* Remain quiet until the browser allows a user gesture. */ });
    };
    document.addEventListener('pointerdown', play);
    document.addEventListener('keydown', play);
    play();
    return () => {
      current = false;
      removeGestures();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [active, birds]);
  return null;
}
