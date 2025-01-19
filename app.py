from flask import Flask, render_template, request
from flask_socketio import SocketIO, send, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

connected_users = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('join')
def handle_join(data):
    username = data['username']
    sid = request.sid 
    connected_users[sid] = username
    print(f"{username} joined the chat")
    emit('status', {'msg': f"{username} has joined the chat!"}, broadcast=True)

@socketio.on('message')
def handle_message(data):
    sid = request.sid
    username = connected_users.get(sid, 'Anonymous')
    message = f"{username}: {data['msg']}"
    print(message)
    send(message, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    username = connected_users.pop(sid, 'Anonymous')
    print(f"{username} disconnected")
    emit('status', {'msg': f"{username} has left the chat."}, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, debug=True)
