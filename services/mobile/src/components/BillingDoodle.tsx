
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { palette } from '@/theme';

export function BillingDoodle() {
  return (
    <View style={styles.container}>
      <Svg width="120" height="100">
        <Defs>
          <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.violet} stopOpacity="1" />
            <Stop offset="1" stopColor={palette.green} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Path
          d="M 20 80 Q 40 20 80 40 T 120 20"
          fill="none"
          stroke="url(#grad)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <Path
          d="M 10 90 Q 50 30 90 50 T 130 30"
          fill="none"
          stroke="url(#grad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="4, 8"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    opacity: 0.1,
  },
});