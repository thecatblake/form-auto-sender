export interface ContactData {
  sei?: string;
  mei?: string;
  furigana_sei?: string;
  furigana_mei?: string;
  manager?: string;
  name?: string;
  furigana?: string;
  kana?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  company?: string;
  department?: string;
  prefecture?: string;
  post_code?: string;
  address?: string;
}

export enum ContactFormStatus {
  PAGE_NOT_FOUND = 1,
  GET_FAILED = 2,
  CONTACT_NOT_FOUND = 3,
  FILLING_FAILED = 4,
  SUBMIT_FAILED = 5,
  SUCCESS = 6,
}