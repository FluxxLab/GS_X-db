/**
 * Plausible Nigerian delegates for a directory that has to look lived-in
 * before it is.
 *
 * What a delegate sees of another delegate is name, organisation, title,
 * country and an avatar - so those are the fields that have to read as real.
 * What only the system sees keeps them honest: every row carries the tag
 * `seed`, which no audience segment matches, so seeded accounts never get a
 * push and can be purged in one query; emails sit on the reserved `.invalid`
 * TLD, which can never be delivered to or collide with a real person; and
 * the password hash is of a secret nobody holds.
 *
 * Names are assembled per region so first name and surname agree - a Yoruba
 * first name with a Kanuri surname is the kind of thing a Nigerian reader
 * notices at once.
 */
import { randomInt } from 'crypto';
import { AccessTier } from '../entities/delegate.entity';

export const SEED_TAG = 'seed';

type Region = {
  first: { f: string[]; m: string[] };
  last: string[];
  weight: number;
  /** Honorifics a reader would accept in front of these names. */
  honorifics?: { f: string[]; m: string[] };
};

// ---------------------------------------------------------------- names
const REGIONS: Record<string, Region> = {
  yoruba: {
    weight: 30,
    honorifics: {
      f: ['Dr.', 'Mrs.', 'Ms.', 'Alhaja', 'Barr.', 'Prof.'],
      m: ['Dr.', 'Mr.', 'Alhaji', 'Engr.', 'Barr.', 'Prof.'],
    },
    first: {
      f: [
        'Adebisi',
        'Adeola',
        'Aduke',
        'Bolanle',
        'Bukola',
        'Damilola',
        'Folake',
        'Funmilayo',
        'Ibironke',
        'Kehinde',
        'Modupe',
        'Morenike',
        'Olabisi',
        'Oluwaseun',
        'Omolara',
        'Opeyemi',
        'Ronke',
        'Simisola',
        'Temitope',
        'Titilayo',
        'Yetunde',
        'Yewande',
        'Abisola',
        'Feyisara',
        'Iyabo',
      ],
      m: [
        'Adebayo',
        'Adekunle',
        'Ayodele',
        'Babatunde',
        'Bamidele',
        'Damilare',
        'Femi',
        'Gbenga',
        'Kayode',
        'Kolawole',
        'Lanre',
        'Olamide',
        'Olusegun',
        'Oluwatobi',
        'Rotimi',
        'Seyi',
        'Taiwo',
        'Tunde',
        'Wale',
        'Yinka',
        'Adewale',
        'Akinyemi',
        'Dapo',
        'Jide',
        'Niyi',
      ],
    },
    last: [
      'Adeyemi',
      'Adebayo',
      'Ogunleye',
      'Bankole',
      'Oyelaran',
      'Akinola',
      'Fashola',
      'Balogun',
      'Oyediran',
      'Olanrewaju',
      'Adegoke',
      'Ojo',
      'Ajayi',
      'Salami',
      'Odunsi',
      'Ogundipe',
      'Shittu',
      'Lawal',
      'Oyebode',
      'Fakunle',
      'Adesanya',
      'Abiodun',
      'Olaniyan',
      'Ogunbiyi',
      'Kolade',
    ],
  },
  igbo: {
    weight: 25,
    first: {
      f: [
        'Adaeze',
        'Amaka',
        'Chiamaka',
        'Chidinma',
        'Chinelo',
        'Chioma',
        'Ebele',
        'Ifeoma',
        'Ijeoma',
        'Ngozi',
        'Nkechi',
        'Nneka',
        'Obiageli',
        'Oluchi',
        'Onyinye',
        'Uchenna',
        'Ugochi',
        'Adanna',
        'Chinwe',
        'Ogechi',
        'Somtochukwu',
        'Kosisochukwu',
      ],
      m: [
        'Chibuzo',
        'Chidi',
        'Chukwuemeka',
        'Emeka',
        'Ikenna',
        'Kelechi',
        'Nnamdi',
        'Obinna',
        'Okechukwu',
        'Onyekachi',
        'Tobechukwu',
        'Uche',
        'Chukwudi',
        'Ebuka',
        'Ifeanyi',
        'Kenechukwu',
        'Nonso',
        'Obiora',
        'Somto',
        'Zik',
      ],
    },
    last: [
      'Okafor',
      'Okonkwo',
      'Nwosu',
      'Eze',
      'Okoro',
      'Nwachukwu',
      'Obi',
      'Anyanwu',
      'Chukwu',
      'Igwe',
      'Okeke',
      'Nnaji',
      'Ezeh',
      'Onwuka',
      'Udeh',
      'Madu',
      'Agu',
      'Ibe',
      'Ekwueme',
      'Onyeka',
      'Nwankwo',
      'Uzoma',
      'Okolie',
      'Ugwu',
      'Achebe',
    ],
  },
  hausa: {
    weight: 25,
    honorifics: {
      f: ['Dr.', 'Hajiya', 'Malama', 'Barr.', 'Prof.'],
      m: ['Dr.', 'Alhaji', 'Mallam', 'Engr.', 'Barr.', 'Prof.'],
    },
    first: {
      f: [
        'Aisha',
        'Amina',
        'Fatima',
        'Hadiza',
        'Halima',
        'Hauwa',
        'Jamila',
        'Khadija',
        'Maryam',
        'Rukayya',
        'Safiya',
        'Sadiya',
        'Zainab',
        'Bilkisu',
        'Habiba',
        'Nafisa',
        'Rahama',
        'Ummi',
        'Zahra',
        "Asma'u",
      ],
      m: [
        'Abdullahi',
        'Abubakar',
        'Aliyu',
        'Bashir',
        'Ibrahim',
        'Isah',
        'Kabiru',
        'Musa',
        'Nasiru',
        'Sani',
        'Shehu',
        'Umar',
        'Usman',
        'Yusuf',
        'Bala',
        'Garba',
        'Hamza',
        'Idris',
        'Mustapha',
        'Salisu',
      ],
    },
    last: [
      'Abdullahi',
      'Bello',
      'Danjuma',
      'Garba',
      'Ibrahim',
      'Lawal',
      'Mohammed',
      'Musa',
      'Sani',
      'Shehu',
      'Suleiman',
      'Yakubu',
      'Yusuf',
      'Adamu',
      'Aliyu',
      'Dantata',
      'Gambo',
      'Hassan',
      'Jibril',
      'Kabir',
      'Maikudi',
      'Tanko',
      'Umar',
      'Wada',
      'Zubairu',
    ],
  },
  edo: {
    weight: 6,
    first: {
      f: [
        'Osarumen',
        'Eghosa',
        'Osaretin',
        'Ivie',
        'Uyi',
        'Efe',
        'Esohe',
        'Osasere',
        'Adesuwa',
        'Itohan',
      ],
      m: [
        'Osagie',
        'Osaze',
        'Ehimen',
        'Ogbeide',
        'Nosa',
        'Ehis',
        'Aiwerioba',
        'Osahon',
        'Omoruyi',
        'Etinosa',
      ],
    },
    last: [
      'Osagie',
      'Igbinedion',
      'Omoregie',
      'Ehigiator',
      'Aigbe',
      'Idahosa',
      'Osemwegie',
      'Eweka',
      'Oviasu',
      'Obaseki',
      'Iyayi',
      'Airhihenbuwa',
    ],
  },
  efik: {
    weight: 5,
    first: {
      f: [
        'Arit',
        'Ekaette',
        'Ime',
        'Iniobong',
        'Mfon',
        'Nsikak',
        'Uduak',
        'Idara',
        'Ekemini',
        'Abasiama',
      ],
      m: [
        'Aniekan',
        'Edidiong',
        'Effiong',
        'Ekpenyong',
        'Emem',
        'Etim',
        'Okon',
        'Ubong',
        'Bassey',
        'Enobong',
      ],
    },
    last: [
      'Bassey',
      'Effiong',
      'Ekpo',
      'Etim',
      'Essien',
      'Okon',
      'Udoh',
      'Akpan',
      'Umoh',
      'Ekanem',
      'Inyang',
      'Edet',
    ],
  },
  tiv: {
    weight: 4,
    first: {
      f: [
        'Doosuur',
        'Msurshima',
        'Kwaghdoo',
        'Ngodoo',
        'Mimidoo',
        'Terhemen',
        'Sewuese',
        'Hembadoon',
      ],
      m: [
        'Terfa',
        'Iorwuese',
        'Tersoo',
        'Aondona',
        'Terkimbi',
        'Iorfa',
        'Sesugh',
        'Mnguter',
      ],
    },
    last: [
      'Iorliam',
      'Akume',
      'Gemade',
      'Ayua',
      'Tyokighir',
      'Unongo',
      'Ikyaa',
      'Suswam',
      'Ortom',
      'Agbo',
    ],
  },
  ijaw: {
    weight: 3,
    first: {
      f: ['Preye', 'Ebiere', 'Tamara', 'Diepreye', 'Ebiye', 'Timipre', 'Boma'],
      m: [
        'Tamuno',
        'Ebi',
        'Timi',
        'Ayebatari',
        'Perekeme',
        'Kemepade',
        'Ebipade',
      ],
    },
    last: [
      'Alamieyeseigha',
      'Dickson',
      'Jonathan',
      'Diri',
      'Sylva',
      'Okara',
      'Ogoni',
      'Amaebi',
      'Owei',
      'Ikiba',
    ],
  },
  kanuri: {
    weight: 2,
    honorifics: {
      f: ['Dr.', 'Hajiya', 'Barr.'],
      m: ['Dr.', 'Alhaji', 'Engr.', 'Barr.'],
    },
    first: {
      f: ['Falmata', 'Yagana', 'Fanna', 'Amina', 'Hadiza', 'Zara'],
      m: ['Kyari', 'Bukar', 'Modu', 'Grema', 'Kolo', 'Baba'],
    },
    last: [
      'Shettima',
      'Kyari',
      'Bukar',
      'Zulum',
      'Kaigama',
      'Goni',
      'Mustapha',
      'Mele',
    ],
  },
};

/** Delegations from outside Nigeria, drawn from their own countries' names. */
const ABROAD: Record<string, Region> = {
  Ghana: {
    weight: 1,
    first: {
      f: ['Ama', 'Abena', 'Akosua', 'Adwoa', 'Efua', 'Esi', 'Yaa', 'Afia'],
      m: ['Kwame', 'Kofi', 'Kwabena', 'Yaw', 'Kwesi', 'Kojo', 'Nana', 'Fiifi'],
    },
    last: [
      'Mensah',
      'Owusu',
      'Boateng',
      'Asante',
      'Appiah',
      'Osei',
      'Agyemang',
      'Darko',
      'Acheampong',
      'Ofori',
    ],
  },
  Kenya: {
    weight: 1,
    first: {
      f: [
        'Wanjiru',
        'Achieng',
        'Njeri',
        'Akinyi',
        'Wambui',
        'Nyambura',
        'Atieno',
        'Chebet',
      ],
      m: [
        'Kamau',
        'Otieno',
        'Mwangi',
        'Kipchoge',
        'Ochieng',
        'Njoroge',
        'Kiprop',
        'Odhiambo',
      ],
    },
    last: [
      'Mwangi',
      'Odhiambo',
      'Njoroge',
      'Kariuki',
      'Ouko',
      'Wanjala',
      'Kimani',
      'Omondi',
      'Cheruiyot',
      'Mutua',
    ],
  },
  'The Gambia': {
    weight: 1,
    first: {
      f: ['Fatou', 'Isatou', 'Mariama', 'Awa', 'Binta', 'Haddy', 'Jainaba'],
      m: ['Lamin', 'Modou', 'Ousman', 'Ebrima', 'Bakary', 'Sainey', 'Alieu'],
    },
    last: [
      'Jallow',
      'Ceesay',
      'Jobe',
      'Sanneh',
      'Touray',
      'Camara',
      'Sowe',
      'Bah',
      'Njie',
      'Faal',
    ],
  },
  Benin: {
    weight: 1,
    first: {
      f: [
        'Ayaba',
        'Nadège',
        'Reine',
        'Sènan',
        'Colette',
        'Mireille',
        'Ornella',
      ],
      m: ['Josué', 'Romaric', 'Sèdjro', 'Boris', 'Hervé', 'Ulrich', 'Gildas'],
    },
    last: [
      'Houngbédji',
      'Ahouansou',
      'Dossou',
      'Zinsou',
      'Agbodjan',
      'Kpodar',
      'Adjovi',
      'Gbaguidi',
      'Hounkpatin',
      'Soglo',
    ],
  },
};

// ---------------------------------------------------------------- organisations and titles
const ORGANISATIONS: {
  name: string;
  titles: string[];
  tier?: AccessTier;
  country?: string;
}[] = [
  {
    name: 'Federal Ministry of Women Affairs and Social Development',
    titles: [
      'Deputy Director, Gender Affairs',
      'Assistant Director, Women Development',
      'Programme Officer',
      'Chief Social Welfare Officer',
    ],
  },
  {
    name: 'Federal Ministry of Health and Social Welfare',
    titles: [
      'Assistant Director, Family Health',
      'Programme Officer, Nutrition',
      'Medical Officer',
      'Health Planning Analyst',
    ],
  },
  {
    name: 'Federal Ministry of Education',
    titles: [
      'Deputy Director, Basic Education',
      'Senior Education Officer',
      'Gender Desk Officer',
    ],
  },
  {
    name: 'National Primary Health Care Development Agency',
    titles: [
      'State Immunisation Officer',
      'Monitoring and Evaluation Officer',
      'Community Health Coordinator',
    ],
  },
  {
    name: 'Kaduna State Ministry of Health',
    titles: [
      'Director, Public Health',
      'Reproductive Health Coordinator',
      'Programme Manager',
    ],
  },
  {
    name: 'Kano State Ministry of Women Affairs',
    titles: [
      'Director, Women Development',
      'Gender Officer',
      'Social Welfare Officer',
    ],
  },
  {
    name: 'Lagos State Ministry of Women Affairs and Poverty Alleviation',
    titles: [
      'Head, Gender Unit',
      'Senior Programme Officer',
      'Empowerment Coordinator',
    ],
  },
  {
    name: 'Borno State Primary Health Care Development Agency',
    titles: ['Deputy Director', 'Zonal Coordinator', 'Data Officer'],
  },
  {
    name: 'Nasarawa State Ministry of Education',
    titles: [
      'Director, Girl-Child Education',
      'Education Secretary',
      'Planning Officer',
    ],
  },
  {
    name: 'Bayero University Kano',
    titles: [
      'Senior Lecturer, Centre for Gender Studies',
      'Research Fellow',
      'Lecturer, Economics',
    ],
  },
  {
    name: 'University of Ibadan',
    titles: [
      'Senior Lecturer, Economics',
      'Research Fellow',
      'Postgraduate Researcher',
      'Lecturer, Sociology',
    ],
  },
  {
    name: 'University of Lagos',
    titles: ['Senior Lecturer', 'Research Associate', 'Doctoral Researcher'],
  },
  {
    name: 'University of Maiduguri',
    titles: ['Lecturer, Public Health', 'Research Fellow', 'Senior Lecturer'],
  },
  {
    name: 'Ahmadu Bello University',
    titles: [
      'Senior Lecturer',
      'Research Fellow',
      'Lecturer, Community Medicine',
    ],
  },
  {
    name: 'University of Nigeria, Nsukka',
    titles: ['Senior Lecturer', 'Research Fellow', 'Lecturer, Economics'],
  },
  {
    name: 'Nile University of Nigeria',
    titles: ['Lecturer, Economics', 'Research Associate'],
  },
  { name: 'Veritas University Abuja', titles: ['Lecturer', 'Research Fellow'] },
  {
    name: 'Small Scale Women Farmers Organisation in Nigeria (SWOFON)',
    titles: ['State Coordinator', 'Programme Officer', 'Member'],
  },
  {
    name: 'Women in Successful Careers (WISCAR)',
    titles: ['Programme Manager', 'Mentorship Lead', 'Member'],
  },
  {
    name: 'Centre for Girls Education',
    titles: ['Programme Officer', 'Field Coordinator', 'Team Lead'],
  },
  {
    name: 'Education as a Vaccine',
    titles: ['Programme Officer', 'Advocacy Lead', 'Communications Officer'],
  },
  {
    name: 'Invictus Africa',
    titles: ['Programme Manager', 'Research Officer', 'Advocacy Officer'],
  },
  {
    name: 'TechHer NG',
    titles: ['Programme Lead', 'Community Manager', 'Digital Skills Trainer'],
  },
  {
    name: 'She Forum Africa',
    titles: ['Programme Officer', 'Communications Lead', 'Member'],
  },
  {
    name: 'Girl Effect Nigeria',
    titles: ['Programme Officer', 'Research Associate', 'Content Lead'],
  },
  {
    name: 'Society for Family Health',
    titles: [
      'Programme Manager',
      'Monitoring and Evaluation Officer',
      'State Coordinator',
    ],
  },
  {
    name: 'Plan International Nigeria',
    titles: [
      'Gender Equality Specialist',
      'Programme Officer',
      'Country Programme Advisor',
    ],
  },
  {
    name: 'Save the Children Nigeria',
    titles: [
      'Child Protection Advisor',
      'Programme Officer',
      'Advocacy and Campaigns Officer',
    ],
  },
  {
    name: 'UN Women Nigeria',
    titles: [
      'Programme Specialist',
      'Programme Analyst',
      'Communications Officer',
    ],
  },
  {
    name: 'UNICEF Nigeria',
    titles: [
      'Gender and Development Officer',
      'Health Specialist',
      'Programme Officer',
    ],
  },
  {
    name: 'UNDP Nigeria',
    titles: ['Programme Analyst', 'Gender Specialist', 'Project Coordinator'],
  },
  {
    name: 'World Bank Nigeria',
    titles: [
      'Social Development Specialist',
      'Operations Officer',
      'Consultant',
    ],
  },
  {
    name: 'Gates Foundation, Nigeria Country Office',
    titles: [
      'Programme Officer',
      'Senior Programme Officer',
      'Associate Programme Officer',
    ],
  },
  {
    name: 'MacArthur Foundation Nigeria',
    titles: ['Programme Officer', 'Grants Manager'],
  },
  {
    name: 'Ford Foundation West Africa',
    titles: ['Programme Officer', 'Programme Associate'],
  },
  {
    name: 'Clinton Health Access Initiative Nigeria',
    titles: ['Programme Manager', 'Associate', 'Senior Analyst'],
  },
  {
    name: 'Pathfinder International Nigeria',
    titles: ['Programme Manager', 'Technical Advisor', 'State Team Lead'],
  },
  {
    name: 'Innovations for Poverty Action Nigeria',
    titles: ['Research Manager', 'Research Associate', 'Field Manager'],
  },
  {
    name: 'Nigerian Economic Summit Group',
    titles: ['Policy Analyst', 'Research Associate', 'Programme Manager'],
  },
  {
    name: "Nigeria Governors' Forum Secretariat",
    titles: ['Programme Officer', 'Health Desk Officer', 'Policy Analyst'],
  },
  {
    name: "Nigeria Governors' Spouses Forum",
    titles: ['Programme Officer', 'Coordinator'],
  },
  {
    name: 'Bank of Industry',
    titles: [
      'Deputy Manager',
      'Relationship Manager',
      'Assistant Manager, Gender Business',
    ],
  },
  {
    name: 'Sterling Bank',
    titles: ['Head, Agribusiness', 'Relationship Manager', 'Product Manager'],
  },
  {
    name: 'Access Bank',
    titles: [
      'Group Head, W Initiative',
      'Relationship Manager',
      'Product Manager',
    ],
  },
  {
    name: 'NIRSAL Plc',
    titles: ['Finance Facilitation Officer', 'Regional Manager', 'Analyst'],
  },
  { name: 'Sabou Capital', titles: ['Investment Associate', 'Analyst'] },
  {
    name: 'HerVest',
    titles: ['Head of Growth', 'Product Manager', 'Community Manager'],
  },
  {
    name: 'Sahel Consulting',
    titles: ['Consultant', 'Senior Consultant', 'Analyst'],
  },
  {
    name: 'TechnoServe Nigeria',
    titles: [
      'Programme Manager',
      'Business Advisor',
      'Senior Business Advisor',
    ],
  },
  {
    name: 'Corus International',
    titles: ['Public Sector Engagement Specialist', 'Programme Officer'],
  },
  {
    name: 'Channels Television',
    titles: ['Correspondent', 'Producer', 'Reporter'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'Arise News',
    titles: ['Correspondent', 'Reporter', 'Producer'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'Premium Times',
    titles: ['Senior Reporter', 'Development Correspondent', 'Editor'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'The Guardian Nigeria',
    titles: ['Correspondent', 'Features Writer'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'Daily Trust',
    titles: ['Correspondent', 'Senior Reporter'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'TVC News',
    titles: ['Reporter', 'Producer'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'News Central Television',
    titles: ['Correspondent', 'Producer'],
    tier: AccessTier.PRESS,
  },
  {
    name: 'FCDO Nigeria',
    titles: ['Development Advisor', 'Programme Manager', 'Policy Officer'],
  },
  {
    name: 'High Commission of Canada in Nigeria',
    titles: ['Development Officer', 'Programme Manager'],
  },
  {
    name: 'Global Bridges Gambia',
    titles: ['Programme Officer', 'Director'],
    country: 'The Gambia',
  },
  {
    name: 'Ministry of Gender, Children and Social Protection, Ghana',
    titles: ['Deputy Director', 'Programme Officer'],
    country: 'Ghana',
  },
  {
    name: 'Kenya Ministry of Gender, Culture, the Arts and Heritage',
    titles: ['Senior Programme Officer', 'Policy Analyst'],
    country: 'Kenya',
  },
  {
    name: 'Ministry of Women Affairs, Republic of Benin',
    titles: ['Programme Officer', 'Deputy Director'],
    country: 'Benin',
  },
];

// the same five thematic tracks the app offers at onboarding
const TRACKS = ['digital', 'economic', 'gbv', 'health', 'security'];
const INTERESTS = [
  'Keynotes & Plenaries',
  'Panel Discussions',
  'Masterclasses & Workshops',
  'Policy Roundtables',
  'Research Presentations',
  'Exhibition Booths',
  'Innovation Pitches',
  'Product Demos',
  'Toolkits & Playbooks',
  'Poster Displays',
  'Partner Matchmaking',
  'Peer Networking',
  'VIP Receptions',
  'Sector Meetups',
  'Investor & Donor Meetings',
  'PPP Coalitions',
  'Sponsorship & Co-Hosting',
  'Hackathon Demos',
  'Design Sprints',
  'Award Ceremonies',
  'Media Briefings',
  'Storytelling Showcases',
];
const HONORIFICS_F = ['Dr.', 'Mrs.', 'Ms.', 'Barr.', 'Prof.'];
const HONORIFICS_M = ['Dr.', 'Mr.', 'Engr.', 'Barr.', 'Prof.'];

// ---------------------------------------------------------------- generation
const pick = <T>(xs: readonly T[]): T => xs[randomInt(xs.length)];
const sample = <T>(xs: readonly T[], n: number): T[] => {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length)
    out.push(pool.splice(randomInt(pool.length), 1)[0]);
  return out;
};
const weightedRegion = (): Region => {
  const total = Object.values(REGIONS).reduce((s, r) => s + r.weight, 0);
  let roll = randomInt(total);
  for (const r of Object.values(REGIONS)) {
    if ((roll -= r.weight) < 0) return r;
  }
  return REGIONS.yoruba;
};
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();

export interface SeedDelegate {
  name: string;
  email: string;
  title: string;
  organisation: string;
  country: string;
  accessTier: AccessTier;
  tracks: string[];
  interests: string[];
  tags: string[];
}

export function generate(count: number): SeedDelegate[] {
  const used = new Set<string>();
  const out: SeedDelegate[] = [];
  while (out.length < count) {
    const org = pick(ORGANISATIONS);
    // a delegation from abroad carries its own country's names
    const region = (org.country && ABROAD[org.country]) || weightedRegion();
    const female = randomInt(100) < 62; // a gender summit skews that way
    const first = pick(female ? region.first.f : region.first.m);
    const last = pick(region.last);
    // one delegate in twelve carries a title the way the printed list does,
    // and only one their own region would use
    const honorifics = region.honorifics ?? {
      f: HONORIFICS_F,
      m: HONORIFICS_M,
    };
    const honorific =
      randomInt(12) === 0
        ? pick(female ? honorifics.f : honorifics.m) + ' '
        : '';

    let local = `${slug(first)}.${slug(last)}`;
    if (used.has(local)) local = `${local}${randomInt(10, 99)}`;
    if (used.has(local)) continue;
    used.add(local);

    // VIP is rare and never at a media house; press follows the organisation
    const tier =
      org.tier ?? (randomInt(40) === 0 ? AccessTier.VIP : AccessTier.STANDARD);

    out.push({
      name: `${honorific}${first} ${last}`,
      email: `${local}@gs26.invalid`,
      title: pick(org.titles),
      organisation: org.name,
      country: org.country ?? 'Nigeria',
      accessTier: tier,
      tracks: sample(TRACKS, randomInt(1, 4)),
      interests: sample(INTERESTS, randomInt(2, 6)),
      tags: [SEED_TAG],
    });
  }
  return out;
}
