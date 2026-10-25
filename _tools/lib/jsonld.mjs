/* Structured data. One Organization node, repeated on every page so @id references resolve, plus
   WebSite, WebPage and BreadcrumbList.

   Organization, not Dentist or MedicalClinic: European Dental is an agency that connects patients with
   clinics; it does not treat anyone, and the markup must not say it does.

   Deliberately ABSENT until confirmed, because a value here is crawled and cached as fact: telephone,
   email and address while they are TODO, opening hours, sameAs, and never aggregateRating or Review. */

const isTodo = (v) => typeof v === "string" && /^TODO/.test(v);

export function orgNode(site, origin, description, languages) {
  const node = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: site.name,
    url: `${origin}/`,
    /* An ImageObject rather than a bare URL string: both are valid, and the object is the form that
       carries the dimensions, which is what lets a consumer decide whether the logo fits a slot
       without fetching it.
       600x349 is measured off assets/brand/logo-stacked-600.png, not assumed from the filename: the
       first attempt here said 450 and was wrong. If the logo is ever re-exported, measure it again. */
    logo: {
      "@type": "ImageObject",
      "@id": `${origin}/#logo`,
      url: `${origin}/assets/brand/logo-stacked-600.png`,
      width: 600,
      height: 349,
      caption: site.name,
    },
    description,
    knowsLanguage: languages,
  };
  const phone = (site.phones || []).map((p) => p.e164).find((v) => !isTodo(v));
  if (phone) node.telephone = phone;
  if (!isTodo(site.email)) node.email = site.email;
  if (!isTodo(site.address)) node.address = { "@type": "PostalAddress", streetAddress: site.address };
  return node;
}

export function websiteNode(site, origin, lang) {
  return { "@type": "WebSite", "@id": `${origin}/#website`, url: `${origin}/`, name: site.name, inLanguage: lang, publisher: { "@id": `${origin}/#organization` } };
}

export function webPageNode(origin, pagePath, title, description, lang, about) {
  const node = {
    "@type": "WebPage", "@id": `${origin}${pagePath}#webpage`, url: `${origin}${pagePath}`, name: title,
    description, inLanguage: lang, isPartOf: { "@id": `${origin}/#website` },
  };
  if (about) node.about = { "@id": `${origin}/#organization` };
  return node;
}

/* A Service the agency arranges, for a treatment page. No `offers` and no price: the owner's decision
   on 2026-10-25 is that no figure is published anywhere, and an Offer without a price says less than
   no Offer at all. provider points at the Organization, which is the honest relationship: we arrange
   the service, a clinic performs it. serviceType stays the page's own subject so this never becomes a
   second place where what we do is described. */
export function serviceNode(origin, pagePath, name, description, areaServed) {
  return {
    "@type": "Service",
    "@id": `${origin}${pagePath}#service`,
    name,
    description,
    serviceType: name,
    provider: { "@id": `${origin}/#organization` },
    areaServed,
  };
}

export function breadcrumbNode(origin, pagePath, crumbs) {
  return {
    "@type": "BreadcrumbList", "@id": `${origin}${pagePath}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${origin}${c.path}` })),
  };
}

export function graphScript(nodes) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": nodes });
  return `<script type="application/ld+json">${json.replace(/</g, "\\u003c")}</script>`;
}
