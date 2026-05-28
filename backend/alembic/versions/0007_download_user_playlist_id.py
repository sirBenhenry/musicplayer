"""add user_playlist_id to download_jobs

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'download_jobs',
        sa.Column(
            'user_playlist_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('user_playlists.id', ondelete='SET NULL'),
            nullable=True,
        ),
    )
    op.create_index('ix_download_jobs_user_playlist_id', 'download_jobs', ['user_playlist_id'])


def downgrade():
    op.drop_index('ix_download_jobs_user_playlist_id', table_name='download_jobs')
    op.drop_column('download_jobs', 'user_playlist_id')
