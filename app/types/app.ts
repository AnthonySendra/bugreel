export interface Reel {
  id: string
  filename: string
  original_name: string | null
  size: number | null
  created_at: number
  uploaded_by_email: string | null
  reporter_name: string | null
  status: string | null
  ticket_id: string | null
  ticket_url: string | null
  assigned_user_id: string | null
  assigned_user_email: string | null
  tags: string[] | null
  share_token: string | null
  is_screenshot: number
}

export interface ReelsResponse {
  items: Reel[]
  hasMore: boolean
  nextBefore: number | null
  totalCount: number
}
