// Blog post catalog. The /blog index page reads this list, /blog/[slug]
// renders a single entry. Order is reverse-chronological (newest first).
//
// IMAGES: stable Unsplash photo IDs you can hot-link via images.unsplash.com
// with a sizing/quality query string. We pre-pick semi-truck shots so each
// post has a visually consistent hero. New posts can pick any image from
// https://unsplash.com/s/photos/semi-truck (use the photo ID in the URL).

export type BlogPost = {
  slug: string;
  title: string;
  description: string;     // SEO meta description AND the index card preview
  topic: string;           // short label used in the topic chip
  publishedAt: string;     // ISO date
  readingMinutes: number;
  hero: { src: string; alt: string; credit: string; creditUrl: string };
  // Inline HTML body. Use the helper components in Haulock.tsx (BlogH2,
  // BlogP, BlogCallout, etc.) — but here we just ship a raw HTML string
  // because it keeps the catalog dead simple and still SEO-friendly.
  // No em-dashes anywhere (brand rule).
  bodyHtml: string;
  // Optional CTA banner shown at the bottom of the article. When haulockHelps
  // is true we render the orange "How Haulock helps" block in addition to
  // the standard "Verify a broker" CTA.
  haulockHelps: boolean;
  haulockHelpsCopy?: string;
  keywords: string[];      // SEO keywords for the meta tag on the post page
};

const unsplashHero = (id: string, alt: string, credit: string, creditUrl: string) => ({
  src: `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=2000&q=80`,
  alt,
  credit,
  creditUrl,
});

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'empty-miles-deadhead-real-rate-per-mile',
    title: 'Empty Miles: How to Calculate Deadhead and Your Real Rate per Mile',
    description: 'A load that pays $2.59 a mile can really pay $2.47 once you count the drive to the pickup. Here is how to work out deadhead, fuel and break-even before you book.',
    topic: 'Load planning',
    publishedAt: '2026-10-12',
    readingMinutes: 5,
    hero: {
      src: 'https://images.pexels.com/photos/6563903/pexels-photo-6563903.jpeg?auto=compress&cs=tinysrgb&w=2000',
      alt: 'Red semi-truck with a white trailer on a desert highway below rocky hills',
      credit: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/red-semi-truck-on-the-road-6563903/',
    },
    haulockHelps: true,
    haulockHelpsCopy: 'The Haulock Load planner does this math for you. Upload the rate con (or type the pickup, delivery and rate), add where the truck is, and you get a truck route on the map, empty and loaded miles, drive time with the required breaks, fuel at this week\'s diesel price for the region, and what is left of the rate after your costs.',
    keywords: ['deadhead miles', 'empty miles trucking', 'rate per mile calculator', 'cost per mile trucking', 'is this load worth it'],
    bodyHtml: `
<p>Every load has two parts: the miles you get paid for, and the miles you drive to get there. The second part is deadhead, or empty miles. Brokers quote the rate on loaded miles, so a load can look great on the rate con and still lose money once the truck has to drive 150 miles empty to pick it up.</p>

<h2>The two numbers that matter</h2>
<p><strong>Loaded rate per mile</strong> is what the rate con implies: the rate divided by the miles from pickup to delivery. <strong>All-in rate per mile</strong> is what the truck actually earns: the rate divided by empty miles plus loaded miles.</p>
<p>Take a load from Joliet, IL to Dallas, TX that pays $2,400 for 927 loaded miles. That is $2.59 a mile. If the truck is 44 miles away from the pickup, the trip is 971 miles, and the real rate is $2.47 a mile. Forty-four miles is a small deadhead. At 200 miles empty, the same load drops to about $2.13 a mile.</p>

<h2>Fuel is the biggest cost on most loads</h2>
<p>Fuel cost is simple to estimate: total miles divided by your miles per gallon, times the price of diesel. At 6.5 mpg, the 971-mile trip burns about 149 gallons. At $6.05 a gallon, that is roughly $904, and it applies to the empty miles too.</p>
<p>Diesel prices are not the same everywhere. The U.S. Energy Information Administration publishes weekly on-highway diesel averages by region, and the gap between regions can be large. California usually runs well above the Gulf Coast. Use the price for where you will actually fuel, or your fuel card price if you know it.</p>

<h2>Know your break-even per mile</h2>
<p>Your break-even is your costs divided by total miles. Add fuel, driver pay and everything else that scales with miles: truck payment, insurance, maintenance, tires, tolls. If fuel is $904, the driver earns $0.65 a mile ($631 on this trip), and nothing else is counted yet, the break-even is about $1.58 a mile. The $2,400 load leaves about $865, or $0.89 a mile. Add your other costs per mile and that number shrinks.</p>
<p>The point is not the exact figure. It is that you compare every load against the same yardstick: the all-in rate against your break-even.</p>

<h2>Drive time sets how many days the load takes</h2>
<p>Under the federal hours-of-service rules for property carriers, a driver can drive up to 11 hours after 10 consecutive hours off duty. A trip with about 15 hours of driving needs at least one 10-hour break, so it is a two-day run even though the miles look like a long day. That matters when you stack the next load.</p>

<h2>Before you say yes</h2>
<ol>
  <li>Measure empty miles from where the truck really is, not where it will be "around noon".</li>
  <li>Work out the all-in rate, not just the loaded rate.</li>
  <li>Price fuel for the lane you are running.</li>
  <li>Compare against your break-even per mile.</li>
  <li>Ask for more when the deadhead is long. Many brokers will move on rate when you show the numbers.</li>
</ol>
`,
  },

  {
    slug: 'owner-operator-vs-company-driver-who-pays-fuel',
    title: 'Owner-Operator or Company Driver: Who Pays for Fuel, and What Is Left of the Rate',
    description: 'Flat pay, per mile or a percentage of the rate, and who buys the fuel. The same load can leave very different money for the carrier and the driver.',
    topic: 'Driver pay',
    publishedAt: '2026-10-07',
    readingMinutes: 5,
    hero: {
      src: 'https://images.pexels.com/photos/4744710/pexels-photo-4744710.jpeg?auto=compress&cs=tinysrgb&w=2000',
      alt: 'Fuel pump with diesel and unleaded grades at a gas station',
      credit: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/gasoline-pump-in-a-gas-station-4744710/',
    },
    haulockHelps: true,
    haulockHelpsCopy: 'In the Haulock Load planner, pick how the driver is paid (flat, per mile or a percentage of the rate) and tick "Driver pays for fuel" for owner-operators. You see what your company keeps and what the driver keeps after fuel, side by side, before you book the load.',
    keywords: ['owner operator pay', 'percentage pay trucking', 'who pays fuel owner operator', 'driver pay per mile', 'dispatcher load math'],
    bodyHtml: `
<p>When a dispatcher or a small carrier looks at a load, the question is not only "does it pay?" but "who gets what?" The answer depends on two things: how the driver is paid, and who buys the fuel.</p>

<h2>Three common ways drivers get paid</h2>
<ul>
  <li><strong>Per mile.</strong> A set amount for every mile, for example $0.65. Simple, and it pays the driver for empty miles too if you count them.</li>
  <li><strong>Flat per load.</strong> A fixed amount for the trip, for example $900. Common for regional runs and dedicated lanes.</li>
  <li><strong>Percentage of the rate.</strong> The driver gets a share of what the load pays, for example 88%. This is the usual setup for owner-operators leased to a carrier or working with a dispatcher.</li>
</ul>

<h2>Who buys the fuel changes everything</h2>
<p>With a company driver, the company buys the fuel. Fuel and driver pay both come out of the rate, and the company keeps the rest.</p>
<p>With an owner-operator on percentage pay, the driver usually buys the fuel. The company keeps its share of the rate and does not pay for fuel at all. The owner-operator pays fuel out of their share.</p>

<h2>One load, two setups</h2>
<p>Take a $2,400 load of 971 total miles, with about $904 of fuel at this week's prices.</p>
<p><strong>Company driver at $0.65 a mile:</strong> the driver earns about $631. The company pays $904 for fuel and $631 for the driver, and keeps about $865.</p>
<p><strong>Owner-operator at 88% who buys the fuel:</strong> the owner-operator's share is $2,112. After about $904 of fuel, they keep roughly $1,208. The company keeps the other 12%, or $288, and pays no fuel.</p>
<p>Neither setup is better on its own. What matters is that both sides can see the numbers before the load is booked, so nobody is surprised when the settlement comes.</p>

<h2>Questions to settle up front</h2>
<ol>
  <li><strong>Percentage of what?</strong> Agree whether the percentage applies to the linehaul only or to the full rate including fuel surcharge and extras.</li>
  <li><strong>Are empty miles paid?</strong> On per-mile pay, decide whether deadhead counts.</li>
  <li><strong>Who pays detention, lumpers and tolls?</strong> Write it down. These are where most settlement disputes start.</li>
  <li><strong>Which fuel price?</strong> For planning, use the regional weekly average or the fuel card price the driver actually pays.</li>
</ol>
`,
  },

  {
    slug: 'how-to-read-carrier-roadside-inspection-history',
    title: 'How to Read a Carrier\'s Roadside Inspection History Before You Book',
    description: 'Inspections and crashes tell you how a carrier really runs. Here is what to look for in the last 24 months, and what not to read too much into.',
    topic: 'Safety data',
    publishedAt: '2026-10-01',
    readingMinutes: 6,
    hero: {
      src: 'https://images.pexels.com/photos/12261472/pexels-photo-12261472.jpeg?auto=compress&cs=tinysrgb&w=2000',
      alt: 'White semi-truck on a highway under a stormy sky',
      credit: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/a-white-truck-on-the-road-12261472/',
    },
    haulockHelps: true,
    haulockHelpsCopy: 'Every Haulock carrier report now lists each roadside inspection and crash from the last 24 months, from FMCSA\'s daily inspection and crash files: a month-by-month chart, the latest inspections with each violation, and whether a truck or driver was put out of service.',
    keywords: ['carrier inspection history', 'roadside inspection levels', 'out of service rate', 'FMCSA crash history', 'vet a carrier safety'],
    bodyHtml: `
<p>Authority and insurance tell you a carrier is allowed to haul. Roadside inspections tell you how it actually runs. Every time a truck is pulled in at a scale or on the roadside, the result goes to FMCSA, and it stays on the carrier's record.</p>

<h2>Inspection levels in plain English</h2>
<ul>
  <li><strong>Level I</strong> is a full inspection of the driver and the vehicle.</li>
  <li><strong>Level II</strong> is a walk-around: driver and vehicle, without getting under the truck.</li>
  <li><strong>Level III</strong> is driver only: license, medical card, hours of service.</li>
  <li><strong>Level V</strong> is vehicle only, often done at the carrier's terminal.</li>
</ul>
<p>A Level III with no violations says the paperwork was in order. It says nothing about brakes. A clean Level I says much more.</p>

<h2>What out of service means</h2>
<p>An out-of-service result means the officer found a problem serious enough that the truck or the driver could not continue until it was fixed. Vehicle out-of-service is usually brakes, tires or lights. Driver out-of-service is usually hours of service, a missing or invalid license, or a medical card issue.</p>

<h2>Five things to look for</h2>
<ol>
  <li><strong>The trend.</strong> Are out-of-service results getting less common, or more? A carrier that had a bad spring and a clean summer is different from one getting worse every month.</li>
  <li><strong>Rates, not counts.</strong> A 300-truck fleet will have far more inspections than a 3-truck one. Compare the share of inspections that ended out of service. FMCSA shows national averages on each carrier's SAFER page.</li>
  <li><strong>The same violation again and again.</strong> One brake problem is a bad day. Brakes on every other inspection is a maintenance program problem.</li>
  <li><strong>Driver versus vehicle.</strong> Driver out-of-service results point at hiring and logs. Vehicle results point at the shop.</li>
  <li><strong>Recent crashes with injuries.</strong> Look at when and where. Tow-away crashes are common on busy lanes. Several injury crashes in a short time are worth a question.</li>
</ol>

<h2>What not to read too much into</h2>
<p><strong>Crash records do not say who was at fault.</strong> A carrier that was rear-ended at a light gets the same crash record as one that caused the crash. For some crash types FMCSA reviews preventability, but most records do not show it.</p>
<p><strong>No inspections is not the same as a clean record.</strong> A new or very small carrier may have no history at all. That is not a red flag, but it means you are trusting other checks: authority age, insurance, identity and references.</p>
<p><strong>Recent events weigh more.</strong> FMCSA's Safety Measurement System counts the last 24 months and gives the most recent events the most weight, so a carrier's scores can improve as old problems age out.</p>

<h2>Timing</h2>
<p>Inspections reach FMCSA a few days after they happen, sometimes longer. The record you see today may be missing last week's inspection.</p>
`,
  },

  {
    slug: 'email-alert-fmcsa-inspection-crash-your-dot',
    title: 'Get an Email When FMCSA Posts an Inspection or Crash on Your DOT',
    description: 'Brokers, shippers and insurers read your inspection record. Here is why you should see each new inspection and crash first, and what to do when one is wrong.',
    topic: 'Your company',
    publishedAt: '2026-09-24',
    readingMinutes: 5,
    hero: {
      src: 'https://images.pexels.com/photos/6325904/pexels-photo-6325904.jpeg?auto=compress&cs=tinysrgb&w=2000',
      alt: 'Person going through paperwork next to a laptop',
      credit: 'Vanessa Garcia',
      creditUrl: 'https://www.pexels.com/photo/photo-of-person-flipping-pages-6325904/',
    },
    haulockHelps: true,
    haulockHelpsCopy: 'On Haulock paid plans, turn on monitoring for your own company and we check FMCSA every day. You get an email for each new roadside inspection and crash filed on your DOT, with the date, place, result and each violation, plus an email when your FMCSA record itself changes: insurance, authority, address, phone, email or officers.',
    keywords: ['FMCSA inspection alert', 'CSA score monitoring', 'DataQs challenge inspection', 'carrier safety record', 'monitor my DOT number'],
    bodyHtml: `
<p>Most owners find out about a bad inspection when an insurer brings it up at renewal, or when a broker turns them down for a load. By then it has been on the record for weeks. You can do better by watching your own DOT the same way your customers do.</p>

<h2>Who reads your record</h2>
<ul>
  <li><strong>Brokers and shippers</strong> check your inspections, out-of-service results and crashes before they tender loads.</li>
  <li><strong>Insurers</strong> look at the same data when they price your renewal.</li>
  <li><strong>FMCSA</strong> uses it in the Safety Measurement System. Recent events count the most, for 24 months.</li>
</ul>

<h2>Why seeing it first matters</h2>
<p>Inspection reports reach FMCSA a few days after the stop. When you see each one as soon as it posts, you can act while the details are fresh: the driver remembers the stop, the repair receipt is in the truck, and there is time to fix a pattern before it becomes a trend.</p>

<h2>When an inspection or crash is wrong</h2>
<p>Mistakes happen. An inspection can land on the wrong DOT number, list a violation that was not there, or miss that a defect was fixed on the spot. FMCSA's <strong>DataQs</strong> system is how you ask for a review. Send the inspection report number, a clear explanation and your proof: photos, repair receipts, logs or a statement from the driver.</p>
<p>Crash records do not show fault. For certain crash types, such as being rear-ended or hit while legally stopped, you can ask FMCSA through DataQs to review whether the crash was preventable. A not-preventable finding is noted on your record.</p>

<h2>A simple routine for every new event</h2>
<ol>
  <li><strong>Read the report.</strong> Check the DOT number, the truck, the date and every violation.</li>
  <li><strong>Talk to the driver</strong> the same day.</li>
  <li><strong>Fix and document.</strong> Keep repair receipts and photos with the report number.</li>
  <li><strong>Challenge errors</strong> in DataQs, with proof.</li>
  <li><strong>Look for patterns.</strong> Two brake violations in a month is a shop conversation, not bad luck.</li>
</ol>

<h2>Watch the rest of your record too</h2>
<p>Identity thieves hijack carriers by quietly changing the phone, email, address or officers on the FMCSA record, so broker verification calls go to them. A change you did not make is the first sign. Watching inspections and record changes together covers both the safety side and the fraud side of your DOT.</p>
`,
  },

  {
    slug: 'how-to-spot-edited-rate-con-pdf',
    title: 'How to Spot an Edited Rate Con: Saved Versions, White-Out Boxes and Typed-On-Top Text',
    description: 'A changed rate on a forwarded rate con leaves traces inside the PDF. Here is what editing looks like, and what is normal and should not worry you.',
    topic: 'PDF forensics',
    publishedAt: '2026-09-17',
    readingMinutes: 6,
    hero: {
      src: 'https://images.pexels.com/photos/8441818/pexels-photo-8441818.jpeg?auto=compress&cs=tinysrgb&w=2000',
      alt: 'Man reading a document next to a laptop',
      credit: 'Kampus Production',
      creditUrl: 'https://www.pexels.com/photo/a-man-looking-at-documents-8441818/',
    },
    haulockHelps: true,
    haulockHelpsCopy: 'Haulock\'s PDF check opens the file itself: it rebuilds every saved version, shows the exact text that changed (for example $1,625.00 to $1,525.00), finds white-out boxes, typed-on-top text and hidden text, and highlights each spot on a preview of your PDF. It also tells you what is normal, like filled-in form fields and signatures. No AI, and the file is never stored on our servers.',
    keywords: ['edited rate con', 'PDF tampering', 'rate confirmation fraud', 'detect edited PDF', 'dispatcher changed rate'],
    bodyHtml: `
<p>Here is how it usually goes. A broker sends a rate con for $1,625. Someone in the middle, often a dispatcher, opens the PDF in a free online editor or in Acrobat, changes the 6 to a 5, saves it, and forwards the $1,525 version to the driver. The driver hauls the load and never sees the real number.</p>
<p>The good news is that editing a PDF almost always leaves traces inside the file.</p>

<h2>PDFs keep the earlier version</h2>
<p>When a PDF is edited and saved, most programs do not rewrite the whole file. They add the changes to the end and keep the original inside. That earlier version can be rebuilt and compared with the current one, page by page, so you can see exactly which text changed and when.</p>

<h2>Signs of editing</h2>
<ul>
  <li><strong>Text that changed in a later save.</strong> The strongest sign: the earlier version said $1,625.00 and the current one says $1,525.00.</li>
  <li><strong>A white box over text, with new text on top.</strong> The classic cover-up when an editor cannot change the original text directly.</li>
  <li><strong>A typed text box sitting on the page.</strong> Some editors add a text box on top of the original number instead of changing it.</li>
  <li><strong>Acrobat's edit marker.</strong> When text is retyped with Acrobat's Edit Text tool, it often leaves a marker on that text.</li>
  <li><strong>Online editors in the file's history.</strong> Tools like free web PDF editors often write their name into the file.</li>
  <li><strong>Hidden text</strong> drawn invisibly on a page that is not a scan.</li>
  <li><strong>Changes after a digital signature,</strong> when the signature covers an earlier version only.</li>
</ul>

<h2>What is normal</h2>
<p>Not every change is fraud, and a good check tells you that too.</p>
<ul>
  <li><strong>Filled-in form fields</strong> are meant to be filled in after the document is made.</li>
  <li><strong>Digital signatures</strong> add a saved version. That is how signing works.</li>
  <li><strong>Scanned pages with a text layer</strong> carry invisible text so they can be searched. That is OCR, not hiding.</li>
  <li><strong>Accessibility tags and re-saves</strong> that do not change any visible text or drawing are harmless.</li>
</ul>

<h2>What to do when the check says edited</h2>
<ol>
  <li>Ask for the rate con straight from the broker, not forwarded.</li>
  <li>Call the broker on the phone number FMCSA has for them, not the number on the PDF, and confirm the rate and load number.</li>
  <li>Keep both versions of the file. If money is involved, the earlier version inside the PDF is evidence.</li>
</ol>
`,
  },

  {
    slug: 'spoofed-broker-emails-one-letter-thousands',
    title: 'Spoofed Broker Emails: How One Letter Costs You Thousands',
    description: 'Scammers forge broker email addresses to redirect carrier payments. The address looks right at a glance, but a single swapped character drains the account.',
    topic: 'Email spoofing',
    publishedAt: '2026-04-25',
    readingMinutes: 4,
    hero: {
      src: 'https://images.pexels.com/photos/2199293/pexels-photo-2199293.jpeg?auto=compress&cs=tinysrgb&w=2000',
      alt: 'Two white Volvo semi-trucks on a highway at sunset',
      credit: 'Quintin Gellar',
      creditUrl: 'https://www.pexels.com/photo/blue-and-yellow-phone-modules-2199293/',
    },
    haulockHelps: true,
    haulockHelpsCopy: 'Haulock checks the sender domain on every rate confirmation against the broker\'s FMCSA-registered website. If the email arrived from a lookalike domain (a swapped letter, a subtle TLD change), we flag it inside the report before you wire a cent.',
    keywords: ['freight email spoofing', 'broker email scam', 'rate con fraud', 'lookalike domain trucking', 'wire fraud carriers'],
    bodyHtml: `
<p>Email spoofing happens when a scammer forges a sender's address to make a fraudulent message look like it came from someone you trust. In freight, that means fake emails from brokers, shippers, or carriers asking you to change a payment account, cancel a load, or wire to a new bank. The email protocols underneath your inbox were never designed with authentication, so a spoofed message can look almost identical to the real thing.</p>

<h2>What it looks like in real life</h2>
<p>You get an email from what looks like your regular broker. They confirm a load you booked yesterday, then ask you to wire payment to a new account because of a "system update". The sender address looks right at first glance. You wire $8,000.</p>
<p>Three hours later your real broker calls asking why you never picked up the load. The email address was one character off: a double <strong>v</strong> instead of a <strong>w</strong>, or a zero instead of the letter <strong>O</strong>. The money is gone, and your bank cannot pull it back.</p>

<h2>Why this works on experienced carriers</h2>
<p>Two reasons. First, dispatch happens fast. You're glancing at the sender, not staring at it. Second, the lookalike domain is paired with a real load context the scammer already knows about, often because they hijacked an inbox earlier in the chain. By the time you read the email, every detail (load number, pickup, rate) lines up.</p>

<h2>How to protect yourself this week</h2>
<ol>
  <li><strong>Never act on payment changes from email alone.</strong> Pick up the phone. Call the broker on a number you already had on file (not one in the email). Verify the change in real time.</li>
  <li><strong>Read the sender address character by character.</strong> Lookalike domains use swapped letters, extra periods, or subtle misspellings. <code>broker.com</code> vs <code>brokers.com</code>. <code>logistics-co.com</code> vs <code>logistlcs-co.com</code>.</li>
  <li><strong>Check the reply-to.</strong> Sometimes the From looks legit but the reply-to points to a free Gmail/Outlook address. That alone is a hard stop.</li>
  <li><strong>Slow down on urgency.</strong> Real brokers do not need you to wire in 30 minutes. Pressure plus payment change equals scam, every time.</li>
  <li><strong>Trust your spam warnings.</strong> If your mail client says "this sender is unverified" or "first contact", do not click the links in the email until you have confirmed by phone.</li>
</ol>

<h2>What to do if you already wired</h2>
<p>Call your bank within minutes if you can. ACH and wire reversals are time-sensitive. File an FBI IC3 report at ic3.gov. File a police report so your insurance has paperwork. And tell the broker you thought you wired to, since they may be able to identify the inbox compromise on their end and warn other carriers.</p>
`,
  },

  {
    slug: 'double-brokering-explained-stop-losing-loads',
    title: 'Double Brokering Explained: How to Stop Losing Your Load to a Stranger',
    description: 'Double brokering is when a broker quietly re-brokers your load to a second carrier, often with no insurance and no chain of custody. Here is how it works and how to spot it.',
    topic: 'Double brokering',
    publishedAt: '2026-04-22',
    readingMinutes: 5,
    hero: unsplashHero(
      '1565891741441-64926e441838',
      'Aerial view of semi-truck trailers lined up at a logistics yard',
      'Marcin Jozwiak',
      'https://unsplash.com/photos/aerial-view-of-warehouse-and-trucks',
    ),
    haulockHelps: true,
    haulockHelpsCopy: 'Before you sign a rate confirmation, Haulock cross-checks the broker\'s authority status, surety bond, and address against FMCSA. We also run a web-reputation scan across FreightWaves, Land Line, TruckersReport, BBB, and government enforcement sites — so a double-broker who already burned someone in trade press shows up in your report instead of in your bank statement.',
    keywords: ['double brokering', 'freight fraud', 'unauthorized re-brokering', 'carrier non-payment', 'FMCSA broker authority'],
    bodyHtml: `
<p>Double brokering is one of the oldest scams in trucking and one of the costliest. A broker takes your tender, then quietly hands the load to a second carrier (or a fake one) without your knowledge. Sometimes the second carrier is real but uninsured. Sometimes there is no carrier at all. By the time the load is missing or the invoice goes unpaid, the original broker has disappeared.</p>

<h2>The two flavors you need to know</h2>
<p><strong>Soft double-broker:</strong> A real broker takes the load and re-brokers it to a real carrier without the shipper's permission. The shipper is paying broker A. Broker A is paying broker B. Broker B is paying the carrier. Margins compress, payment slows, and if anything goes wrong nobody is contractually accountable.</p>
<p><strong>Hard double-broker:</strong> A scammer impersonates a legitimate carrier, uses their MC number, and books loads under that identity. They subcontract to a real driver who picks the load up in good faith. The shipper pays the impersonator. The real driver never sees a dime, and the impersonating "broker" vanishes inside two weeks.</p>

<h2>What it looks like in real life</h2>
<p>You are dispatched a tender from a broker you have never worked with. The rate is 15 to 20 percent above market. They are eager. They send the rate con within minutes of your first call. The pickup goes fine, you deliver, you invoice. Net 30 comes and goes. Net 45. The broker stops returning calls. The phone number on the rate con starts going to voicemail. Three months later you find out the load was double-brokered and the original shipper paid the original broker, who paid the imposter, who never paid you.</p>

<h2>Red flags before you accept the load</h2>
<ul>
  <li><strong>Above-market rate from an unfamiliar broker.</strong> Real brokers do not give away margin to strangers.</li>
  <li><strong>New MC, no online history.</strong> The broker's MC was issued in the last 90 days. No reviews. No company website. No LinkedIn. No Google Business listing.</li>
  <li><strong>Generic email domain.</strong> Gmail, Yahoo, Outlook. Real brokers have a company domain.</li>
  <li><strong>Authority status mismatch.</strong> The MC is "Active" on FMCSA but the company name on the rate con does not match the legal name in FMCSA records.</li>
  <li><strong>No surety bond on file.</strong> Brokers must carry a $75,000 BMC-84 or BMC-85 bond. If FMCSA shows none, walk away.</li>
  <li><strong>Address resolves to a residential building or a coworking space.</strong> Legit brokerages have offices.</li>
</ul>

<h2>How to verify in five minutes</h2>
<ol>
  <li>Pull the broker's MC on FMCSA SAFER. Confirm authority is active and the legal name matches the rate con header.</li>
  <li>Confirm an active surety bond. No bond, no load.</li>
  <li>Search the broker's name plus the word "fraud" and plus the word "non-payment". Read the first two pages of results.</li>
  <li>Cross-check the broker's email domain against the website FMCSA has on file. Mismatched domains are a hard stop.</li>
  <li>Call the broker on a phone number you got from an independent source (FMCSA, their website, a broker directory). Confirm the load and the rate verbally.</li>
</ol>

<h2>How to protect yourself if a load smells off mid-haul</h2>
<p>Stop, photograph everything, get the original shipper's contact info if you can, and document who handed off the load. Call your factor or your insurance broker to flag the load before anything bad happens. Do not deliver until you have a clear paper trail back to the original shipper.</p>
`,
  },

  {
    slug: 'identity-theft-fmcsa-stolen-mc-numbers',
    title: 'Identity Theft on FMCSA: How Scammers Steal Your MC and Run Loads in Your Name',
    description: 'Carriers wake up to a load they never booked, a customer they never met, and a debt they did not run. MC identity theft is fast, automated, and surprisingly easy to fix if you catch it early.',
    topic: 'Identity theft',
    publishedAt: '2026-04-18',
    readingMinutes: 6,
    hero: unsplashHero(
      '1519003722824-194d4455a60c',
      'Semi-truck driving down a highway at sunrise',
      'Marcin Jozwiak',
      'https://unsplash.com/photos/red-semi-truck-on-road-Hb4D5GA1pCk',
    ),
    haulockHelps: true,
    haulockHelpsCopy: 'Haulock auto-monitors your MC every 24 hours and emails you the moment something on your FMCSA record changes: address, phone, insurance, authority status. If a scammer updates your record to redirect freight to themselves, you find out the same day, not three weeks later.',
    keywords: ['MC number theft', 'FMCSA identity fraud', 'carrier identity theft', 'stolen DOT number', 'chameleon carrier'],
    bodyHtml: `
<p>Carrier identity theft used to require effort. Today it takes a Google search, a credit card, and ten minutes. Scammers pull your MC and DOT off public FMCSA records, log into a load board with a new account in your name, book a load, and disappear with the freight. The first you hear about it is a phone call from the broker asking why the truck never showed up, or a small claim for $40,000 in lost cargo.</p>

<h2>How they do it</h2>
<p>FMCSA's SAFER system makes carrier records fully public. Your MC, DOT, legal name, address, contact phone, fleet size, and insurance carrier are all one search away. Scammers automate this. They scrape the database, file fake address change forms, set up forwarding emails and phone numbers, and impersonate you on load boards, fuel networks, and broker portals.</p>

<h2>What it looks like in real life</h2>
<p>A broker you have never spoken to calls and asks where their truck is. They have a rate confirmation with your company name, your MC, and your DOT, but a phone number you do not recognize. The driver they spoke to gave a name nobody at your company has ever heard. Meanwhile someone has changed the contact email on your FMCSA record, and you cannot log into your own L&amp;I portal to fix it.</p>

<h2>Six red flags it is happening to you right now</h2>
<ul>
  <li><strong>FMCSA-record changes you did not make.</strong> A new address, a new phone, a new email, a new contact name.</li>
  <li><strong>Brokers calling you about loads you never booked.</strong> Especially if the loads originate from a region you do not run.</li>
  <li><strong>Carrier setup packets arriving from brokers you never solicited.</strong> Someone signed up under your name.</li>
  <li><strong>Factoring statements with invoices that are not yours.</strong> Loads that were never on your dispatch.</li>
  <li><strong>Mail going somewhere else.</strong> Insurance renewals or FMCSA correspondence stops arriving.</li>
  <li><strong>Calls from the FBI, state patrol, or a shipper's insurer.</strong> By this point you are fixing something serious.</li>
</ul>

<h2>How to harden your identity now</h2>
<ol>
  <li><strong>Lock your FMCSA login.</strong> Use the L&amp;I portal to set a strong password, enable 2FA where supported, and verify your contact email is one you actively monitor.</li>
  <li><strong>Set a Google Alert</strong> for your company name, your MC number, and your DOT number. Free. Catches mentions you would otherwise never see.</li>
  <li><strong>Check FMCSA SAFER monthly.</strong> Confirm address, phone, email, and insurance match what you have on file. If anything is wrong, file a correction immediately.</li>
  <li><strong>Use carrier monitoring.</strong> Tools like Haulock automate the daily check and email you the moment something on your record changes.</li>
  <li><strong>Train dispatch.</strong> Anyone calling about a load that is not on the board does not get information. They get a callback after the load is verified.</li>
</ol>

<h2>What to do if it has already happened</h2>
<p>File an FMCSA Form OP-1 fraud complaint. File a police report. File an FBI IC3 report at ic3.gov. Notify your insurance carrier and your factor. Send a written notice to every load board you use, asking them to flag any account using your MC. Document everything in writing. Recovery is possible, but speed matters: every day a scammer holds your MC is another day they can book another load.</p>
`,
  },

  {
    slug: 'rate-con-red-flags-before-you-sign',
    title: '12 Rate Con Red Flags You Should Catch Before You Sign',
    description: 'A rate confirmation is more than a contract. It is a fingerprint of the broker who sent it. Twelve quick checks that catch most freight scams in under two minutes.',
    topic: 'Rate confirmations',
    publishedAt: '2026-04-15',
    readingMinutes: 5,
    hero: unsplashHero(
      '1592838064575-70ed626d3a0e',
      'Volvo semi-truck on an open highway with mountains at sunset',
      'Marcin Jozwiak',
      'https://unsplash.com/photos/blue-and-white-volvo-truck-on-road',
    ),
    haulockHelps: true,
    haulockHelpsCopy: 'Haulock\'s rate con analyzer reads the PDF you upload and runs every one of these checks in under a minute. We compare the broker name to FMCSA, score the language for scam markers, and verify the email domain matches the website. You get a clear verdict before you hook up.',
    keywords: ['rate confirmation fraud', 'rate con red flags', 'freight broker scam signs', 'PDF fraud detection', 'broker verification checklist'],
    bodyHtml: `
<p>A rate con tells you a lot more than a load number and a rate. It tells you who really sent it. Use the next two minutes to run through this list before you sign anything. Most freight scams trip at least three of these.</p>

<h2>The 12 checks</h2>
<ol>
  <li><strong>Logo at the top.</strong> Real brokers have a real logo at the top of the rate con. Pixelated, blurry, or stretched logos that look like a Google Image grab usually are.</li>
  <li><strong>Header company name vs FMCSA legal name.</strong> The name printed at the top of the rate con must match the legal name on FMCSA SAFER for that MC. Trade names without DBA registration are a yellow flag.</li>
  <li><strong>MC number printed as text.</strong> If the only place you see the broker's MC is inside their logo image, OCR can be fooled. Make sure the number is also printed in plain text somewhere on the document.</li>
  <li><strong>Address that matches FMCSA.</strong> Cross-check the address on the rate con header with the address FMCSA has on file. If FMCSA says Dallas, TX and the rate con says a UPS Store in Miami, that is the moment to slow down.</li>
  <li><strong>Email domain that matches the website.</strong> If the broker's website is acmelogistics.com, their email should be name@acmelogistics.com. Free Gmail or Outlook addresses on a rate con are a near-certain scam indicator.</li>
  <li><strong>Lookalike domain check.</strong> Read the email letter by letter. acmelogistics.com vs acme-logistics.com vs acme1ogistics.com (that is a number 1, not a lowercase L). They are not the same domain.</li>
  <li><strong>Phone number that resolves to a business.</strong> Call it. Make sure it goes to a switchboard or a named human who can confirm the load. A voicemail with no greeting is a red flag.</li>
  <li><strong>Reasonable rate for the lane.</strong> Rates 15 to 25 percent above market are a classic double-broker setup.</li>
  <li><strong>No urgency language.</strong> "MUST PICK UP TODAY", "URGENT", and all-caps pressure throughout the document are scam markers. Real brokers do not need to scream.</li>
  <li><strong>Payment terms that match industry norms.</strong> Net 30 is standard. Net 45 with a quick-pay fee under 2 percent is fine. Anything asking you to wire upfront, pay a service charge to "release" the load, or split payment to multiple bank accounts is fraud.</li>
  <li><strong>Carrier section addressed correctly.</strong> Make sure the rate con names YOUR company correctly, with the right MC and DOT. Some scams send the same rate con template to twenty carriers with the wrong identity in the carrier block.</li>
  <li><strong>Surety bond on file.</strong> FMCSA requires brokers to carry a $75,000 BMC-84 or BMC-85 bond. If the bond is missing or expired, the broker cannot legally book the load.</li>
</ol>

<h2>How to use this list</h2>
<p>Print it. Tape it to your dispatch monitor. Anyone in your office who handles rate cons should be able to run through these in under two minutes. Three flags is a slow down. Five flags is a hard no.</p>
`,
  },

  {
    slug: 'cargo-theft-strategic-fictitious-pickup',
    title: 'Strategic Cargo Theft: When the "Carrier" Picking Up Was Never Real',
    description: 'Strategic cargo theft uses fake carriers, stolen identities, and fictitious pickups to walk away with full trailers of freight. Here is what brokers and shippers can do.',
    topic: 'Cargo theft',
    publishedAt: '2026-04-11',
    readingMinutes: 5,
    hero: unsplashHero(
      '1669087655247-eda1d7282931',
      'Blue Volvo semi-truck cab parked under a blue sky',
      'Unsplash',
      'https://unsplash.com/photos/1669087655247-eda1d7282931',
    ),
    haulockHelps: false,
    keywords: ['strategic cargo theft', 'fictitious pickup', 'freight theft prevention', 'cargo security', 'trucking fraud'],
    bodyHtml: `
<p>Strategic cargo theft is the cleaner cousin of smash-and-grab. There is no broken trailer seal. There is no warehouse breach. The "carrier" walks up to the dock with a tablet, the right paperwork, and a smile, and drives away with an entire load of freight that was never theirs to pick up. By the time the real carrier arrives, the dock is empty and the freight is on its way to a buyer who never asks where it came from.</p>

<h2>The anatomy of a strategic theft</h2>
<p>Step one: the thief impersonates a real carrier, usually one with a clean MC and a long history. They use the carrier's MC and DOT to set up new email addresses, a virtual phone number, and a load board account. Step two: they bid on real loads from real brokers, accept the rate con, and dispatch a driver, often through a real but unwitting subcontractor. Step three: the driver shows up at the shipping dock with the paperwork in hand, picks up the freight, and disappears. The shipper paid the broker. The broker paid the impersonator. The driver paid no one anything.</p>

<h2>What gets targeted</h2>
<p>High-value, easy-to-fence, hard-to-trace freight: electronics, copper, food and beverage in fast-moving categories, paper goods (genuinely a target), certain pharmaceuticals, automotive parts. Anything that can be sold on a secondary market without a serial number trail.</p>

<h2>Where the holes are</h2>
<p>Three places: the broker's onboarding (no carrier vetting, or rubber-stamp vetting), the load board's carrier identity verification (often weak), and the shipping facility's pickup verification (often based on nothing more than the rate con plus the driver's stated company name).</p>

<h2>How to protect yourself</h2>
<ol>
  <li><strong>Verify the carrier's MC, DOT, and authority status the day the load is booked.</strong> Use FMCSA SAFER directly. Do not trust a load-board badge.</li>
  <li><strong>Confirm the carrier's contact info matches FMCSA.</strong> Email domain, business address, and phone should line up with what FMCSA has on file. New, free email domains are a flag.</li>
  <li><strong>Call the carrier on a phone number you got from FMCSA, not from the load-board listing.</strong> A real dispatcher answers. If the only contact is a cell phone, slow down.</li>
  <li><strong>Use the load board's carrier verification feature, but do not stop there.</strong> Most load boards verify "is this MC active" not "is this person actually that MC".</li>
  <li><strong>At the shipping dock, confirm the truck's actual DOT number on the cab matches the carrier on the bill of lading.</strong> Take a photo of the cab, the trailer, and the driver's CDL. This is your insurance claim evidence.</li>
  <li><strong>Use load-tracking from pickup to delivery.</strong> A real carrier will accept ELD-based tracking with no hesitation. Resistance to tracking is a flag.</li>
  <li><strong>Know your high-risk lanes.</strong> Florida, Southern California, the Memphis-Atlanta corridor, and parts of New Jersey see disproportionate strategic theft activity. Tighten your verification on those lanes.</li>
</ol>

<h2>What to do when freight goes missing</h2>
<p>Call your insurance carrier within hours. File a CargoNet report (cargonet.com) so the freight is flagged across the recovery network. File a police report at the pickup location. File an FBI IC3 report at ic3.gov. The first 24 hours determine whether you recover a trailer or write off a load.</p>

<h2>Why we are honest that this one is harder to stop with software</h2>
<p>Most fraud Haulock catches is identity-based: who really sent this rate con, does this MC really belong to this company, is this email domain a lookalike. Strategic theft moves the fraud onto the dock. Software helps at the booking step. The dock-side verification has to live with shippers and dispatch teams. So while we will never claim Haulock prevents cargo theft after pickup, we can prevent the booking step that opens the door to it.</p>
`,
  },

  {
    slug: 'verifying-broker-five-minutes-before-load',
    title: 'How to Verify Any Broker in Five Minutes Before You Hook the Trailer',
    description: 'A repeatable five-minute checklist for vetting any new broker. Built around free public sources so you can run it on every load, not just the suspicious ones.',
    topic: 'Broker verification',
    publishedAt: '2026-04-08',
    readingMinutes: 4,
    hero: unsplashHero(
      '1591768793355-74d04bb6608f',
      'Driver climbing into a semi-truck cab',
      'Caleb Ruiter',
      'https://unsplash.com/photos/man-driving-tractor-trailer-close-up-photography-AeC60RYthVM',
    ),
    haulockHelps: true,
    haulockHelpsCopy: 'Haulock runs all five of these checks in parallel, usually in under half a minute, and gives you a single risk score with a verdict. The free plan gives you three lookups a month, which is enough to vet anyone you have a doubt about. Paid plans cover everyone.',
    keywords: ['broker verification', 'vet a freight broker', 'FMCSA SAFER lookup', 'carrier due diligence', 'how to verify a broker'],
    bodyHtml: `
<p>Most carriers have a vetting process for new brokers. Almost none run it on every load. The reason is simple: it takes too long. Here is a five-minute version that fits inside the call where you accept the load. Run it once, save it as a checklist, never haul for a ghost again.</p>

<h2>The five-minute checklist</h2>

<h3>Minute 1: FMCSA SAFER</h3>
<p>Go to <a href="https://safer.fmcsa.dot.gov" target="_blank" rel="noopener">safer.fmcsa.dot.gov</a>. Type the broker's MC. Confirm:</p>
<ul>
  <li>Authority status is "Active" for Broker authority.</li>
  <li>Legal name on the SAFER record matches the company name on the rate con.</li>
  <li>Address on SAFER is consistent with the address on the rate con header.</li>
  <li>The MC is more than 6 months old. Brand-new authorities require extra checks.</li>
</ul>

<h3>Minute 2: Surety bond</h3>
<p>On the same SAFER record, scroll to "Active Insurance" or open the L&amp;I record. Confirm:</p>
<ul>
  <li>BMC-84 or BMC-85 surety bond on file, $75,000 minimum.</li>
  <li>Insurance carrier is one you recognize. Trust bonds from carriers like Avalon, RLI, or Lancer over names you have never seen.</li>
  <li>No recent insurance lapses. Gaps suggest financial stress.</li>
</ul>

<h3>Minute 3: Web presence</h3>
<p>Search the broker's name on Google. You are looking for three things:</p>
<ul>
  <li><strong>A real company website on a real domain</strong> that matches the email address on the rate con.</li>
  <li><strong>A LinkedIn or Google Business listing</strong> with employees, photos, or reviews.</li>
  <li><strong>The phrase "fraud" or "non-payment"</strong> in any context. Read the first page of results. If carriers have been writing complaints about this broker, you will see it.</li>
</ul>

<h3>Minute 4: Phone verification</h3>
<p>Call the phone number on the broker's FMCSA record (not the one on the rate con, which can be a forwarding number set up by an impersonator). Confirm with whoever answers:</p>
<ul>
  <li>The load number you are about to accept.</li>
  <li>The pickup and delivery details.</li>
  <li>The rate.</li>
  <li>The dispatcher's name on the rate con works there.</li>
</ul>
<p>If a fact does not match, you have caught either an honest miscommunication or a scam. Either way, slow down.</p>

<h3>Minute 5: Bond claims and community signal</h3>
<p>Search the broker's name on Carrier411 or any broker-rating community you trust. You are looking for:</p>
<ul>
  <li>Open bond claims.</li>
  <li>Multiple non-payment complaints in the last 12 months.</li>
  <li>Pattern of carriers reporting the broker for shorting payments or stretching net terms past 60 days.</li>
</ul>

<h2>What three or more flags means</h2>
<p>It does not mean the broker is a fraud. Honest brokers can hit one or two flags (newer authority, a gap in insurance, a quiet web presence). Three or more is when you should think hard, raise the rate to compensate for risk, or pass.</p>

<h2>What zero flags means</h2>
<p>It does not mean the load is risk-free. It means the broker passed the basic identity check. The rate con itself can still hide problems. Run the rate-con checklist on top of this. The two together stop most freight fraud at the door.</p>
`,
  },
];

export function getPostBySlug(slug: string): BlogPost | null {
  return BLOG_POSTS.find((p) => p.slug === slug) || null;
}
