export interface Job {
  id: string;
  code: string;
  customer: string;
  address: string;
  crewLeader: string | null;
  crewSize: number | null;
  phone: string | null;
  email: string | null;
  jobType: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  lat: number | null;
  lng: number | null;
}
