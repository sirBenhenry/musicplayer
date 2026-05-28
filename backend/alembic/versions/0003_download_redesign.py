"""download system redesign: scoring, MB identity, notifications

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend download_jobs with MusicBrainz identity + scoring + pipeline tracking
    op.add_column("download_jobs", sa.Column("mb_recording_id", sa.String(36), nullable=True))
    op.add_column("download_jobs", sa.Column("mb_artist_id", sa.String(36), nullable=True))
    op.add_column("download_jobs", sa.Column("mb_release_id", sa.String(36), nullable=True))
    op.add_column("download_jobs", sa.Column("candidates", JSONB, nullable=False, server_default="[]"))
    op.add_column("download_jobs", sa.Column("selected_candidate", JSONB, nullable=True))
    op.add_column("download_jobs", sa.Column("confidence_score", sa.Float, nullable=True))
    op.add_column("download_jobs", sa.Column("quality_score", sa.Float, nullable=True))
    op.add_column("download_jobs", sa.Column("review_status", sa.String(20), nullable=True))
    op.add_column("download_jobs", sa.Column("file_path", sa.String, nullable=True))
    op.add_column("download_jobs", sa.Column("pipeline_log", JSONB, nullable=False, server_default="[]"))
    op.add_column("download_jobs", sa.Column("auto_expires_at", sa.DateTime(timezone=True), nullable=True))

    # Notification center
    op.create_table(
        "user_notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("download_job_id", UUID(as_uuid=True),
                  sa.ForeignKey("download_jobs.id", ondelete="CASCADE"), nullable=True),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("dismissed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("action_taken", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_user_notifications_undismissed",
        "user_notifications",
        ["dismissed", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_notifications_undismissed", "user_notifications")
    op.drop_table("user_notifications")

    op.drop_column("download_jobs", "auto_expires_at")
    op.drop_column("download_jobs", "pipeline_log")
    op.drop_column("download_jobs", "file_path")
    op.drop_column("download_jobs", "review_status")
    op.drop_column("download_jobs", "quality_score")
    op.drop_column("download_jobs", "confidence_score")
    op.drop_column("download_jobs", "selected_candidate")
    op.drop_column("download_jobs", "candidates")
    op.drop_column("download_jobs", "mb_release_id")
    op.drop_column("download_jobs", "mb_artist_id")
    op.drop_column("download_jobs", "mb_recording_id")
