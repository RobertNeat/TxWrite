export interface Project {
  id: string;
  name: string;
  ownerProfileId: string;
  engine: string;
  mainFile: string;
  templateOrigin: string | null;
  createdAt: string;
  updatedAt: string;
}
