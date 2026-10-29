export interface USStateConfig {
  code: string;
  name: string;
  representativeCity: string;
  latitude: number;
  longitude: number;
  defaultStation?: string;
}

const states: Array<[string, string, string, number, number]> = [
  ['AL','Alabama','Montgomery',32.3777,-86.3000], ['AZ','Arizona','Phoenix',33.4484,-112.0740], ['AR','Arkansas','Little Rock',34.7465,-92.2896], ['CA','California','Sacramento',38.5767,-121.4944], ['CO','Colorado','Denver',39.7392,-104.9903], ['CT','Connecticut','Hartford',41.7640,-72.6822], ['DE','Delaware','Dover',39.1573,-75.5197], ['FL','Florida','Tallahassee',30.4383,-84.2807], ['GA','Georgia','Atlanta',33.7490,-84.3880], ['ID','Idaho','Boise',43.6178,-116.1997], ['IL','Illinois','Springfield',39.7984,-89.6544], ['IN','Indiana','Indianapolis',39.7686,-86.1626], ['IA','Iowa','Des Moines',41.5911,-93.6037], ['KS','Kansas','Topeka',39.0482,-95.6779], ['KY','Kentucky','Frankfort',38.1867,-84.8753], ['LA','Louisiana','Baton Rouge',30.4571,-91.1874], ['ME','Maine','Augusta',44.3072,-69.7817], ['MD','Maryland','Annapolis',38.9784,-76.4922], ['MA','Massachusetts','Boston',42.3582,-71.0637], ['MI','Michigan','Lansing',42.7336,-84.5553], ['MN','Minnesota','Saint Paul',44.9551,-93.1022], ['MS','Mississippi','Jackson',32.3038,-90.1821], ['MO','Missouri','Jefferson City',38.5792,-92.1729], ['MT','Montana','Helena',46.5857,-112.0184], ['NE','Nebraska','Lincoln',40.8081,-96.6997], ['NV','Nevada','Carson City',39.1638,-119.7661], ['NH','New Hampshire','Concord',43.2069,-71.5370], ['NJ','New Jersey','Trenton',40.2206,-74.7699], ['NM','New Mexico','Santa Fe',35.6822,-105.9397], ['NY','New York','Albany',42.6528,-73.7579], ['NC','North Carolina','Raleigh',35.7804,-78.6391], ['ND','North Dakota','Bismarck',46.8208,-100.7833], ['OH','Ohio','Columbus',39.9613,-82.9995], ['OK','Oklahoma','Oklahoma City',35.4922,-97.5033], ['OR','Oregon','Salem',44.9385,-123.0304], ['PA','Pennsylvania','Harrisburg',40.2644,-76.8836], ['RI','Rhode Island','Providence',41.8309,-71.4149], ['SC','South Carolina','Columbia',34.0003,-81.0332], ['SD','South Dakota','Pierre',44.3670,-100.3464], ['TN','Tennessee','Nashville',36.1658,-86.7842], ['TX','Texas','Austin',30.2747,-97.7403], ['UT','Utah','Salt Lake City',40.7774,-111.8882], ['VT','Vermont','Montpelier',44.2624,-72.5805], ['VA','Virginia','Richmond',37.5389,-77.4336], ['WA','Washington','Olympia',47.0358,-122.9050], ['WV','West Virginia','Charleston',38.3362,-81.6123], ['WI','Wisconsin','Madison',43.0747,-89.3844], ['WY','Wyoming','Cheyenne',41.1403,-104.8202],
];

export const US_STATES_48: readonly USStateConfig[] = states.map(([code, name, representativeCity, latitude, longitude]) => ({ code, name, representativeCity, latitude, longitude }));
