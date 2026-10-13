import React from 'react';
import { Series } from 'remotion';
import { BROKERS_DURATION, ForBrokers } from './ForBrokers';
import { CARRIERS_DURATION, ForCarriers } from './ForCarriers';
import { RateConEdited, SPOT_DURATION } from './RateConEdited';

// The homepage "Watch the demo" video: the carrier, broker and driver reels back to back.
export const DEMO_DURATION = CARRIERS_DURATION + BROKERS_DURATION + SPOT_DURATION;

export const Demo: React.FC = () => (
  <Series>
    <Series.Sequence durationInFrames={CARRIERS_DURATION}>
      <ForCarriers />
    </Series.Sequence>
    <Series.Sequence durationInFrames={BROKERS_DURATION}>
      <ForBrokers />
    </Series.Sequence>
    <Series.Sequence durationInFrames={SPOT_DURATION}>
      <RateConEdited />
    </Series.Sequence>
  </Series>
);
