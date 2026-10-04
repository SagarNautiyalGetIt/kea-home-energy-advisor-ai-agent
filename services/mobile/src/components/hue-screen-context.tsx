import { createContext, useContext } from 'react';

export const HueScreenContext = createContext(false);
export const useHueScreen = () => useContext(HueScreenContext);
