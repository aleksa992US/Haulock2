import React from 'react';
import { Composition } from 'remotion';
import { BrokersPost, CarriersPost, DriversPost, POST_DURATION, POST_H, POST_W } from './posts/Posts';
import { FEATURE_SLIDES } from './posts/FeatureCarousels';
import { INSPECTION_SLIDES } from './posts/InspectionsCarousel';
import { TAMPER_SLIDES } from './posts/TamperCarousel';
import { AUTHORITY_HISTORY_DURATION, AuthorityHistory } from './spots/AuthorityHistory';
import { BrokerPricing, PRICING_DURATION } from './spots/BrokerPricing';
import { COI_CHECK_DURATION, CoiCheck } from './spots/CoiCheck';
import { Demo, DEMO_DURATION } from './spots/Demo';
import { DEMO_LAPTOP_DURATION, DemoLaptop } from './spots/DemoLaptop';
import { DEMO_WIDE_DURATION, DEMO_WIDE_H, DEMO_WIDE_W, DemoWide } from './spots/DemoWide';
import { BROKERS_DURATION, ForBrokers } from './spots/ForBrokers';
import { CARRIERS_DURATION, ForCarriers } from './spots/ForCarriers';
import { INSPECTIONS_DURATION, Inspections } from './spots/Inspections';
import { LOAD_PLANNER_DURATION, LoadPlanner } from './spots/LoadPlanner';
import { OFFICERS_DURATION, Officers } from './spots/Officers';
import { PDF_REPORT_DURATION, PdfReport } from './spots/PdfReport';
import { PDF_TAMPER_DURATION, PdfTamper } from './spots/PdfTamper';
import { RateConEdited, SPOT_DURATION } from './spots/RateConEdited';
import { WHOS_CHECKING_DURATION, WhosChecking } from './spots/WhosChecking';
import { FPS, HEIGHT, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="rate-con-edited" component={RateConEdited} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={SPOT_DURATION} />
    <Composition id="for-brokers" component={ForBrokers} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={BROKERS_DURATION} />
    <Composition id="for-carriers" component={ForCarriers} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={CARRIERS_DURATION} />
    <Composition id="broker-pricing" component={BrokerPricing} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={PRICING_DURATION} />
    <Composition id="pdf-tamper" component={PdfTamper} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={PDF_TAMPER_DURATION} />
    <Composition id="inspections" component={Inspections} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={INSPECTIONS_DURATION} />
    <Composition id="load-planner" component={LoadPlanner} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={LOAD_PLANNER_DURATION} />
    <Composition id="coi-check" component={CoiCheck} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={COI_CHECK_DURATION} />
    <Composition id="whos-checking" component={WhosChecking} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={WHOS_CHECKING_DURATION} />
    <Composition id="officers" component={Officers} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={OFFICERS_DURATION} />
    <Composition id="authority-history" component={AuthorityHistory} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={AUTHORITY_HISTORY_DURATION} />
    <Composition id="pdf-report" component={PdfReport} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={PDF_REPORT_DURATION} />
    <Composition id="demo" component={Demo} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={DEMO_DURATION} />
    <Composition id="demo-60" component={DemoWide} width={DEMO_WIDE_W} height={DEMO_WIDE_H} fps={FPS} durationInFrames={DEMO_WIDE_DURATION} />
    <Composition id="demo-60-laptop" component={DemoLaptop} width={DEMO_WIDE_W} height={DEMO_WIDE_H} fps={FPS} durationInFrames={DEMO_LAPTOP_DURATION} />
    <Composition id="post-brokers" component={BrokersPost} width={POST_W} height={POST_H} fps={FPS} durationInFrames={POST_DURATION} />
    <Composition id="post-carriers" component={CarriersPost} width={POST_W} height={POST_H} fps={FPS} durationInFrames={POST_DURATION} />
    <Composition id="post-drivers" component={DriversPost} width={POST_W} height={POST_H} fps={FPS} durationInFrames={POST_DURATION} />
    {(['en', 'sr'] as const).flatMap((lang) =>
      TAMPER_SLIDES.map((Slide, i) => (
        <Composition key={`${lang}-${i}`} id={`tamper-${lang}-${i + 1}`} component={Slide} defaultProps={{ lang }} width={POST_W} height={POST_H} fps={FPS} durationInFrames={POST_DURATION} />
      ))
    )}
    {(['en', 'sr'] as const).flatMap((lang) =>
      INSPECTION_SLIDES.map((Slide, i) => (
        <Composition key={`insp-${lang}-${i}`} id={`inspections-${lang}-${i + 1}`} component={Slide} defaultProps={{ lang }} width={POST_W} height={POST_H} fps={FPS} durationInFrames={POST_DURATION} />
      ))
    )}
    {FEATURE_SLIDES.map(({ id, component }) => (
      <Composition key={id} id={id} component={component} width={POST_W} height={POST_H} fps={FPS} durationInFrames={POST_DURATION} />
    ))}
  </>
);
