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
    logo: `${origin}/assets/brand/logo-stacked-600.png`,
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
