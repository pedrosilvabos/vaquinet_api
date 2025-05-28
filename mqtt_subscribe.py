import paho.mqtt.client as mqtt
import time

# Callback when connected to the broker
def on_connect(client, userdata, flags, reason_code, properties=None):
    print(f"Connected with result code {reason_code}")
    if reason_code == 0:
        client.subscribe("test/topic")
    else:
        print("Connection failed")

# Callback when a message is received
def on_message(client, userdata, msg, properties=None):
    print(f"Topic: {msg.topic} Message: {msg.payload.decode()}")

# List of ports to try
ports = [10000, 10001, 10002]

for port in ports:
    try:
        print(f"Trying port {port}...")
        # Create MQTT client
        client = mqtt.Client(client_id="test-client-123", protocol=mqtt.MQTTv311, callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        client.on_connect = on_connect
        client.on_message = on_message

        # Connect to the broker
        client.connect("vakinet-mqtt-broker.onrender.com", port, 60)

        # Start the loop to process messages
        client.loop_forever()
    except Exception as e:
        print(f"Failed on port {port}: {e}")
        time.sleep(2)  # Wait before trying next port