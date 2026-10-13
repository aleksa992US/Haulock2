import React from 'react';
import { Composition } from 'remotion';
import { BrokerPricing, PRICING_DURATION } from './spots/BrokerPricing';
import { BROKERS_DURATION, ForBrokers } from './spots/ForBrokers';
import { CARRIERS_DURATION, ForCarriers } from './spots/ForCarriers';
import { RateConEdited, SPOT_DURATION } from './spots/RateConEdited';
import { FPS, HEIGHT, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="rate-con-edited" component={RateConEdited} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={SPOT_DURATION} />
    <Composition id="for-brokers" component={ForBrokers} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={BROKERS_DURATION} />
    <Composition id="for-carriers" component={ForCarriers} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={CARRIERS_DURATION} />
    <Composition id="broker-pricing" component={BrokerPricing} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={PRICING_DURATION} />
  </>
);
