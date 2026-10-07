import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { startHomeAmbience } from '@/lib/home-ambience';
import { useActiveAnimation } from '@/lib/use-active-animation';

const garden = require('../../assets/audio/home-garden.m4a');
const breeze = require('../../assets/audio/home-breeze.m4a');

/** Mounted only when the saved sound switch is on and the home model is ready. */
export function HomeNatureSound({ birds }: { birds: boolean }) {
  const active = useActiveAnimation();
  const player = useAudioPlayer(birds ? garden : breeze, { updateInterval: 1000 });
  useEffect(() => {
    if (!active) { player.pause(); return; }
    return startHomeAmbience(player, setAudioModeAsync);
  }, [active, player]);
  return null;
}
