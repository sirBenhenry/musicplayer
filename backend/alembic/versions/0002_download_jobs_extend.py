"""extend download_jobs for multi-source pipeline

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("download_jobs", sa.Column("item_type", sa.String(16), nullable=False, server_default="track"))
    op.add_column("download_jobs", sa.Column("sources_tried", JSONB, nullable=False, server_default="[]"))
    op.add_column("download_jobs", sa.Column("source_used", sa.String(32), nullable=True))
    op.add_column("download_jobs", sa.Column("last_error", sa.Text, nullable=True))
    op.add_column("download_jobs", sa.Column("retry_count", sa.Integer, nullable=False, server_default="0"))
    op.add_column("download_jobs", sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_download_jobs_retry", "download_jobs", ["next_retry_at"],
                    postgresql_where=sa.text("status = 'failed'"))


def downgrade() -> None:
    op.drop_index("ix_download_jobs_retry", "download_jobs")
    op.drop_column("download_jobs", "next_retry_at")
    op.drop_column("download_jobs", "retry_count")
    op.drop_column("download_jobs", "last_error")
    op.drop_column("download_jobs", "source_used")
    op.drop_column("download_jobs", "sources_tried")
    op.drop_column("download_jobs", "item_type")
