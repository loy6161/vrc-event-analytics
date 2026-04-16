import React, { useState, useEffect } from 'react'
import { Event } from '../types/index.js'
import '../styles/EventForm.css'

interface EventFormProps {
  eventId?: number
  onSuccess?: () => void
}

export function EventForm({ eventId, onSuccess }: EventFormProps) {
  const [loading, setLoading] = useState(!!eventId)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    name: '',
    date: '',
    start_time: '',
    end_time: '',
    world_id: '',
    instance_id: '',
    world_name: '',
    description: '',
    tags: '',
  })

  useEffect(() => {
    if (eventId) {
      fetchEvent(eventId)
    }
  }, [eventId])

  const fetchEvent = async (id: number) => {
    try {
      const response = await fetch(`/api/events/${id}`)
      const data = await response.json()
      if (data.success) {
        const event: Event = data.data
        setForm({
          name: event.name,
          date: event.date,
          start_time: event.start_time || '',
          end_time: event.end_time || '',
          world_id: event.world_id || '',
          instance_id: event.instance_id || '',
          world_name: event.world_name || '',
          description: event.description || '',
          tags: event.tags?.join(',') || '',
        })
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    // Validate
    if (!form.name.trim()) {
      setError('イベント名は必須です')
      return
    }
    if (!form.date) {
      setError('イベント日は必須です')
      return
    }

    try {
      setSubmitting(true)
      const url = eventId ? `/api/events/${eventId}` : '/api/events'
      const method = eventId ? 'PUT' : 'POST'

      const payload = {
        name: form.name,
        date: form.date,
        start_time: form.start_time || undefined,
        end_time: form.end_time || undefined,
        world_id: form.world_id || undefined,
        instance_id: form.instance_id || undefined,
        world_name: form.world_name || undefined,
        description: form.description || undefined,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (data.success) {
        setSuccess(eventId ? 'イベントを更新しました！' : 'イベントを作成しました！')
        setTimeout(() => {
          onSuccess?.()
          window.location.href = '#/events'
        }, 1000)
      } else {
        setError(data.error || 'イベントの保存に失敗しました')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="event-form">読み込み中...</div>

  return (
    <div className="event-form">
      <h2>{eventId ? 'イベントを編集' : '新しいイベントを作成'}</h2>

      {error && <div className="form-alert alert-error">{error}</div>}
      {success && <div className="form-alert alert-success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">イベント名 *</label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="例：Winter Concert 2025"
            value={form.name}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">日付 *</label>
            <input
              id="date"
              name="date"
              type="date"
              value={form.date}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label htmlFor="start_time">開始時刻</label>
            <input
              id="start_time"
              name="start_time"
              type="time"
              value={form.start_time}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label htmlFor="end_time">終了時刻</label>
            <input
              id="end_time"
              name="end_time"
              type="time"
              value={form.end_time}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="world_id">ワールドID</label>
            <input
              id="world_id"
              name="world_id"
              type="text"
              placeholder="wrld_xxx..."
              value={form.world_id}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label htmlFor="world_name">ワールド名</label>
            <input
              id="world_name"
              name="world_name"
              type="text"
              placeholder="ワールド名"
              value={form.world_name}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="instance_id">インスタンスID</label>
          <input
            id="instance_id"
            name="instance_id"
            type="text"
            placeholder="インスタンスID"
            value={form.instance_id}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>

        <div className="form-group">
          <label htmlFor="description">説明</label>
          <textarea
            id="description"
            name="description"
            placeholder="イベントの詳細..."
            value={form.description}
            onChange={handleChange}
            disabled={submitting}
            rows={4}
          />
        </div>

        <div className="form-group">
          <label htmlFor="tags">タグ（カンマで区切る）</label>
          <input
            id="tags"
            name="tags"
            type="text"
            placeholder="タグ1, タグ2, タグ3"
            value={form.tags}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '保存中...' : eventId ? 'イベントを更新' : 'イベントを作成'}
          </button>
          <a href="#/events" className="btn btn-secondary">キャンセル</a>
        </div>
      </form>
    </div>
  )
}
