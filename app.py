# -*- coding: utf-8 -*-

import base64
import os
import os.path
import urllib
import hmac
import json
import hashlib
from base64 import urlsafe_b64decode, urlsafe_b64encode

import requests
from flask import Flask, request, redirect, render_template, url_for, session, abort, make_response
from flask_sqlalchemy import SQLAlchemy

import datetime
from networkx.readwrite import json_graph
import math
import networkx as nx
import psycopg2
import time

FB_APP_ID = os.environ.get('FACEBOOK_APP_ID')
FB_APP_SECRET = os.environ.get('FACEBOOK_SECRET')
FB_APP_NAME = 'Friend Constellation'
SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI')
requests = requests.session()


def oauth_login_url(preserve_path=True, next_url=None):
	fb_login_uri = ("https://www.facebook.com/dialog/oauth"
					"?client_id=%s&redirect_uri=%s" %
					(app.config['FB_APP_ID'], get_home()))

	if app.config['FBAPI_SCOPE']:
		fb_login_uri += "&scope=%s" % ",".join(app.config['FBAPI_SCOPE'])
	return fb_login_uri


def simple_dict_serialisation(params):
	return "&".join(map(lambda k: "%s=%s" % (k, params[k]), params.keys()))


def base64_url_encode(data):
	return base64.urlsafe_b64encode(data).rstrip('=')


def fbapi_get_string(path,
	domain=u'graph', params=None, access_token=None,
	encode_func=urllib.urlencode):
	"""Make an API call"""

	if not params:
		params = {}
	params[u'method'] = u'GET'
	if access_token:
		params[u'access_token'] = access_token

	for k, v in params.iteritems():
		if hasattr(v, 'encode'):
			params[k] = v.encode('utf-8')

	url = u'https://' + domain + u'.facebook.com' + path
	params_encoded = encode_func(params)
	url = url + params_encoded
	result = requests.get(url).content

	return result


def fbapi_auth(code):
	params = {'client_id': app.config['FB_APP_ID'],
			  'redirect_uri': get_home(),
			  'client_secret': app.config['FB_APP_SECRET'],
			  'code': code}

	result = fbapi_get_string(path=u"/oauth/access_token?", params=params,
							  encode_func=simple_dict_serialisation)
	pairs = result.split("&", 1)
	result_dict = {}
	for pair in pairs:
		(key, value) = pair.split("=")
		result_dict[key] = value
	return (result_dict["access_token"], result_dict["expires"])


def fql(fql, token, args=None):
	if not args:
		args = {}

	args["query"], args["format"], args["access_token"] = fql, "json", token

	url = "https://api.facebook.com/method/fql.query"

	r = requests.get(url, params=args)
	return json.loads(r.content)


def fb_call(call, args=None):
	url = "https://graph.facebook.com/{0}".format(call)
	r = requests.get(url, params=args)
	return json.loads(r.content)


app = Flask(__name__)
app.secret_key = FB_APP_SECRET
app.config.from_object(__name__)
app.config.from_object('conf.Config')
db = SQLAlchemy(app)

class User(db.Model):
	__tablename__ = 'fbc_user'
	id = db.Column(db.String(128), primary_key=True)
	name = db.Column(db.String(128))
	username = db.Column(db.String(128))
	link = db.Column(db.String(128))
	charts = db.relationship('Chart', backref='user', lazy='dynamic')

	def __init__(self, id, name, username, link):
		self.id = id
		self.name = name
		self.username = username
		self.link = link

	def __repr__(self):
		return '<User %r>' % self.id

class Chart(db.Model):
	__tablename__ = 'fbc_chart'
	id = db.Column(db.Integer, primary_key=True)
	user_id = db.Column(db.String(128), db.ForeignKey('fbc_user.id'))
	graph_data = db.Column(db.LargeBinary)
	graph_hash = db.Column(db.String(64))
	node_count = db.Column(db.Integer())
	edge_count = db.Column(db.Integer())
	generated_date = db.Column(db.DateTime)
	status = db.Column(db.String(32))

	def __init__(self, user_id, graph_data, graph_hash, node_count, edge_count, generated_date, status):
		self.user_id = user_id
		self.graph_data = graph_data
		self.graph_hash = graph_hash
		self.node_count = node_count
		self.edge_count = edge_count
		self.generated_date = generated_date
		self.status = status

	def __repr__(self):
		return '<Chart %r>' % self.id


def get_home():
	return 'https://' + request.host + '/'


def get_token():
	if ('access_token' in session
		and 'expires' in session
		and time.time() < session['expires']):
		return session['access_token']

	if request.args.get('code', None):
		return fbapi_auth(request.args.get('code'))[0]

	cookie_key = 'fbsr_{0}'.format(FB_APP_ID)

	if cookie_key in request.cookies:

		c = request.cookies.get(cookie_key)
		encoded_data = c.split('.', 2)

		sig = encoded_data[0]
		data = json.loads(urlsafe_b64decode(str(encoded_data[1]) +
			(64-len(encoded_data[1])%64)*"="))

		if not data['algorithm'].upper() == 'HMAC-SHA256':
			raise ValueError('unknown algorithm {0}'.format(data['algorithm']))

		h = hmac.new(FB_APP_SECRET, digestmod=hashlib.sha256)
		h.update(encoded_data[1])
		expected_sig = urlsafe_b64encode(h.digest()).replace('=', '')

		if sig != expected_sig:
			raise ValueError('bad signature')

		params = {
			'client_id': FB_APP_ID,
			'client_secret': FB_APP_SECRET,
			'redirect_uri': '',
			'code': data['code']
		}

		from urlparse import parse_qs
		r = requests.get('https://graph.facebook.com/oauth/access_token', params=params)
		rd = parse_qs(r.content)
		token = rd.get('access_token')
		if token:
			token = token[0]
			me = fb_call('me', args={'access_token': token})

			u = User.query.get(me['id'])
			if not u:
				u = User(me['id'], me['name'], me['username'], me['link'])
				db.session.add(u)
				db.session.commit()

			session['access_token'] = token
			session['expires'] = time.time() + int(rd.get('expires')[0])
			session['uid'] = me['id']

			access_token = get_token()
			accounts = fb_call('/me/accounts', args={'access_token': access_token})
			adminAppIds = map(lambda x: x['id'], filter(lambda x: x['category'] == 'Application', accounts['data']))
			session['is_admin'] = FB_APP_ID in adminAppIds

		else:
			responseData = json.loads(r.content)
			if 'error' in responseData and 'message' in responseData['error']:
				print responseData['error']['message']
			print 'Failed to authenticate with Facebook API.'

		return token


@app.route('/', methods=['GET', 'POST'])
def index():
	return render_template('welcome.html', app_id=FB_APP_ID)

@app.route('/constellation', methods=['GET', 'POST'])
def constellation():
	access_token = get_token()
	if access_token:
		user = User.query.get(session['uid'])
		chart = user.charts.filter(Chart.status == 'ready').order_by(Chart.generated_date.desc()).first()
		
		if chart:
			return render_template('constellation.html', app_id=FB_APP_ID, token=access_token, chart=chart)
		else:
			# No charts are ready yet. Check whether there is one processing.
			# FIXME: Check whether there is a chart processing.
			return render_template('processing.html', app_id=FB_APP_ID, token=access_token)
	else:
		return render_template('login.html', app_id=FB_APP_ID, token=access_token, url=request.url, name=FB_APP_NAME)


@app.route('/chart/', methods=['GET', 'POST'])
def charts():
	if not session.get('is_admin', False):
		abort(403)
	
	access_token = get_token()
	if access_token:
		if not 'uid' in session:
			abort(403)

		charts = Chart.query.filter(Chart.user_id == session['uid']).order_by(Chart.generated_date)
		return render_template('charts.html', app_id=FB_APP_ID, token=access_token, charts=charts)
	else:
		return render_template('login.html', app_id=FB_APP_ID, token=access_token, url=request.url, name=FB_APP_NAME)


@app.route('/chart/<int:chartId>', methods=['GET', 'POST'])
def chart(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	access_token = get_token()
	if access_token:
		if not 'uid' in session:
			abort(403)

		chart = Chart.query.get(chartId)
		if not chart:
			abort(404)

		if chart.user_id != session['uid']:
			abort(403)

		return render_template('constellation.html', app_id=FB_APP_ID, token=access_token, chart=chart)
	else:
		return render_template('login.html', app_id=FB_APP_ID, token=access_token, url=request.url, name=FB_APP_NAME)


@app.route('/chart/<int:chartId>/data', methods=['GET', 'POST'])
def chartData(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if not chart:
		abort(404)

	if not 'uid' in session or chart.user_id != session['uid']:
		abort(403)

	return chart.graph_data


@app.route('/chart/<int:chartId>/clear', methods=['POST'])
def chartClear(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if chart:
		chart.graph_data = ''
		chart.graph_hash = ''
		chart.node_count = 0
		chart.edge_count = 0
		chart.status = None
		db.session.commit()
	
	return redirect('/chart')


@app.route('/chart/<int:chartId>/fetch-data', methods=['POST'])
def chartFetchData(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if chart:
		chart.status = 'fetchingdata'
		db.session.commit()
	
	return redirect('/chart')


@app.route('/chart/<int:chartId>/calc-layout', methods=['POST'])
def chartCalcLayout(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if chart:
		chart.status = 'calculatinglayout'
		db.session.commit()
	
	return redirect('/chart')


@app.route('/chart/<int:chartId>/reset-layout', methods=['POST'])
def chartResetLayout(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if chart:
		data = json.loads(chart.graph_data)

		for n in data['nodes']:
			if 'x' in n:
				del n['x']
			if 'y' in n:
				del n['y']

		chart.graph_data = json.dumps(data)

		db.session.commit()
	
	return redirect('/chart')


@app.route('/chart/<int:chartId>/duplicate', methods=['POST'])
def chartDuplicate(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if chart:
		chart2 = Chart(
			chart.user_id,
			chart.graph_data,
			chart.graph_hash,
			chart.node_count,
			chart.edge_count,
			chart.generated_date,
			chart.status)

		db.session.add(chart2)
		db.session.commit()
	
	return redirect('/chart')


@app.route('/chart/<int:chartId>/delete', methods=['POST'])
def chartDelete(chartId):
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart.query.get(chartId)
	if chart:
		db.session.delete(chart)
		db.session.commit()
	
	return redirect('/chart')


@app.route('/chart/create', methods=['POST'])
def chartCreate():
	if not session.get('is_admin', False):
		abort(403)
	
	chart = Chart(session['uid'], '', '', 0, 0, datetime.datetime.now(), 'created')
	db.session.add(chart)
	db.session.commit()

	return redirect('/chart')


@app.route('/process-jobs', methods=['GET', 'POST'])
def processJobs():
	if not session.get('is_admin', False):
		abort(403)
	
	access_token = get_token()
	if access_token:
		print "Processing jobs..."

		charts = Chart.query.filter(Chart.status == 'fetchingdata')
		for chart in charts:
			print "Fetching data for chart {0}".format(chart.id)
			if processFetchData(chart):
				time.sleep(1)
			else:
				time.sleep(10)
		
		charts = Chart.query.filter(Chart.status == 'calculatinglayout')
		for chart in charts:
			print "Calculating layout for chart {0}".format(chart.id)
			processCalcLayout(chart)
			time.sleep(1)
		
		print "...done processing jobs."

		return redirect('/chart')


def processFetchData(chart):
	access_token = get_token()
	if access_token:
		# NOTE: limiting to 1000 users.
		friends = fql("SELECT uid, name, pic_square FROM user WHERE uid IN (SELECT uid2 FROM friend WHERE uid1=me()) LIMIT 1000", access_token)

		g = nx.Graph()
		g.add_nodes_from(map(lambda x: (str(x['uid']),
			{'id': str(x['uid']), 'name': x.get('name', ''), 'pic_square': x.get('pic_square', '')}),
			friends))

		batchSize = 50
		for i in range(0, int(math.ceil(float(len(friends)) / batchSize))):
			retriesRemaining = 2
			while retriesRemaining > 0:
				print "Batch #" + str(i)
				batchIds = map(lambda x: str(x['uid']), friends[i * batchSize:(i + 1) * batchSize])
				batch = map(lambda x: {'method': 'GET', 'relative_url': "me/mutualfriends/{0}".format(x)}, batchIds)

				url = 'https://graph.facebook.com'
				response = requests.post(url, params={'access_token': access_token, 'batch': json.dumps(batch)})
				responseData = json.loads(response.content)

				errors = filter(lambda x: not x or x['code'] != 200, responseData)
				if len(errors) > 0:
					print "Got errors: (" + str(len(errors)) + ") " + json.dumps(errors)

					if retriesRemaining > 0:
						retriesRemaining -= 1

						time.sleep(10)
						print "Retrying current batch call."

					else:
						print "Giving up."
						chart.status = 'fetchingdataerror'
						db.session.commit()
						return False

				else:
					responseData = map(lambda x: map(lambda y: y['id'], json.loads(x['body'])['data']), responseData)
					for j in range(0, len(responseData)):
						g.add_edges_from(zip([batchIds[j]] * len(responseData[j]), responseData[j]))

					time.sleep(1)
					break

		chart.graph_data = ('{"nodes": '
			+ json.dumps(map(lambda x: x[1], g.nodes(data=True)))
			+ ', "edges": '
			+ json.dumps(g.edges(data=False)) + '}')
		chart.node_count = len(g.nodes())
		chart.edge_count = len(g.edges())
		chart.status = 'datafetched'

		db.session.commit()
		return True
	else:
		print 'Failed to fetch data for chart {0}. No access token.'.format(chart.id)
		return False


def processCalcLayout(chart):
	data = json.loads(chart.graph_data)

	g = nx.Graph()
	initialPos = {}

	for n in data['nodes']:
		g.add_node(n['id'], n)
		if 'x' in n and 'y' in n:
			initialPos[n['id']] = (n['x'], n['y'])

	for e in data['edges']:
		g.add_edge(e[0], e[1])

	layout = nx.spring_layout(g, dim=2, pos=initialPos, iterations=100, scale=1.0)
	for nodeId in layout:
		coords = layout[nodeId]
		g.node[nodeId]['x'] = str(coords[0])
		g.node[nodeId]['y'] = str(coords[1])

	chart.graph_data = ('{"nodes": '
		+ json.dumps(map(lambda x: x[1], g.nodes(data=True)))
		+ ', "edges": '
		+ json.dumps(g.edges(data=False)) + '}')
	chart.node_count = len(g.nodes())
	chart.edge_count = len(g.edges())
	chart.status = 'layoutcalculated'

	db.session.commit()
	return True

@app.route('/test', methods=['GET', 'POST'])
def test():
	return "That's all folks!"

@app.route('/logout', methods=['GET', 'POST'])
def logout():
	"""
		Be sure to call FB.logout as well.
	"""
	session.pop('access_token', None)
	session.pop('expires', None)
	session.pop('uid', None)
	session.pop('is_admin', None)
	return redirect('/')

if __name__ == '__main__':
	port = int(os.environ.get("PORT", 5000))
	if (app.config.get('FB_APP_ID')
		and app.config.get('FB_APP_SECRET')
		and app.config.get('SQLALCHEMY_DATABASE_URI')):
		app.run(host='0.0.0.0', port=port, debug=True)
	else:
		print 'Cannot start application without Facebook App Id and Secret and database URI set'
