import queue
import threading
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from backend.config.realtime import realtime_watcher


class RealtimeSubscriptionTests(IsolatedAsyncioTestCase):
    async def test_closed_channel_reconnects_even_when_socket_is_connected(self):
        stop = threading.Event()
        channel = Mock(is_closed=True)
        channel.subscribe = AsyncMock()
        client = Mock()
        client.channel.return_value = channel
        client.realtime.is_connected = True
        client.realtime.connect = AsyncMock()
        client.realtime.close = AsyncMock()
        client.remove_channel = AsyncMock()
        client.remove_all_channels = AsyncMock()

        async def stop_on_reconnect(delay):
            self.assertEqual(delay, realtime_watcher.RECONNECT_SECONDS)
            stop.set()

        with patch.dict('os.environ', {'SUPABASE_URL': 'https://test.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'test'}), patch(
            'backend.config.realtime.realtime_watcher.create_async_client', AsyncMock(return_value=client)
        ), patch('backend.config.realtime.realtime_watcher.asyncio.sleep', side_effect=stop_on_reconnect) as sleep:
            await realtime_watcher._subscribe_forever(queue.Queue(), stop)
        sleep.assert_awaited_once_with(realtime_watcher.RECONNECT_SECONDS)
        client.remove_channel.assert_awaited_once_with(channel)
        client.realtime.close.assert_awaited_once()

    async def test_open_channel_keeps_listening_without_reconnecting(self):
        stop = threading.Event()
        channel = Mock(is_closed=False)
        channel.subscribe = AsyncMock()
        client = Mock()
        client.channel.return_value = channel
        client.realtime.is_connected = True
        client.realtime.connect = AsyncMock()
        client.realtime.close = AsyncMock()
        client.remove_channel = AsyncMock()
        client.remove_all_channels = AsyncMock()

        async def finish_listening(delay):
            self.assertEqual(delay, 1)
            stop.set()

        with patch.dict('os.environ', {'SUPABASE_URL': 'https://test.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'test'}), patch(
            'backend.config.realtime.realtime_watcher.create_async_client', AsyncMock(return_value=client)
        ), patch('backend.config.realtime.realtime_watcher.asyncio.sleep', side_effect=finish_listening) as sleep:
            await realtime_watcher._subscribe_forever(queue.Queue(), stop)
        sleep.assert_awaited_once_with(1)
        client.remove_channel.assert_awaited_once_with(channel)
