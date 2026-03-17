export interface Reel {
  id: string
  filename: string
  original_name: string | null
  size: number | null
  created_at: number
  uploaded_by_email: string | null
  reporter_name: string | null
}

export interface ReelsResponse {
  items: Reel[]
  hasMore: boolean
  nextBefore: number | null
}
