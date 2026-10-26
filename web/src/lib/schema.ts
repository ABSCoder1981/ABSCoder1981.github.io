import { site } from './site';

const ORG_ID = `${site.url}/#business`;

/** RealEstateAgent + LocalBusiness, on every page. */
export function businessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': ['RealEstateAgent', 'LocalBusiness'],
    '@id': ORG_ID,
    name: site.name,
    url: site.url,
    logo: `${site.url}/icon-512.png`,
    image: `${site.url}/og-image.png`,
    telephone: site.phone.e164,
    email: site.email,
    priceRange: '₹₹₹',
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${site.address.line1}, ${site.address.line2}`,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: site.geo.lat,
      longitude: site.geo.lng,
    },
    hasMap: site.mapUrl,
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: site.hours.days,
        opens: site.hours.opens,
        closes: site.hours.closes,
      },
    ],
    areaServed: ['Kothrud', 'Karvenagar', 'Warje', 'Prabhat Road', 'Bavdhan', 'Erandwane', 'Pune'].map(
      (name) => ({ '@type': 'Place', name }),
    ),
    founder: { '@type': 'Person', name: site.founder.name },
  };
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export type Crumb = { name: string; path: string };

export function breadcrumbSchema(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${site.url}${c.path === '/' ? '' : c.path}`,
    })),
  };
}
