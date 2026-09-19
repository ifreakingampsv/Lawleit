import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import Hero from "./sections/Hero";
import { IconGrid, AssociationsBand, RoiCalculator, StatsRow } from "./sections/Bands";
import { AiSection, LeadSection, CaseSection, BillingSection } from "./sections/Features";
import { DoMore, VideoTestimonial, Reviews, FinalCta } from "./sections/Social";

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <Hero />
        <IconGrid />
        <AssociationsBand />
        <RoiCalculator />
        <StatsRow />
        <AiSection />
        <LeadSection />
        <CaseSection />
        <BillingSection />
        <DoMore />
        <VideoTestimonial />
        <Reviews />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
