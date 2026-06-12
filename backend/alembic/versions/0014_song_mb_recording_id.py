"""Add mb_recording_id to songs

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa

revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('songs', sa.Column('mb_recording_id', sa.String(), nullable=True))
    op.create_index('ix_songs_mb_recording_id', 'songs', ['mb_recording_id'])


def downgrade():
    op.drop_index('ix_songs_mb_recording_id', table_name='songs')
    op.drop_column('songs', 'mb_recording_id')
