--
-- PostgreSQL database dump
--

\restrict dcQia1gy9QOJzTOeM4ftwYf2KGQntVdO1AemhiffdTyCtYAVtEi3cOxsdXDFkEA

-- Dumped from database version 18.3 (Postgres.app)
-- Dumped by pg_dump version 18.3 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: about_image; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.about_image (
    id integer NOT NULL,
    image_url text NOT NULL
);


ALTER TABLE public.about_image OWNER TO charan;

--
-- Name: about_image_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.about_image_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.about_image_id_seq OWNER TO charan;

--
-- Name: about_image_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.about_image_id_seq OWNED BY public.about_image.id;


--
-- Name: admin_config; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.admin_config (
    id integer NOT NULL,
    admin_email character varying(255) NOT NULL,
    admin_password character varying(255) NOT NULL,
    superadmin_email character varying(255) NOT NULL,
    superadmin_password character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.admin_config OWNER TO charan;

--
-- Name: admin_config_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.admin_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admin_config_id_seq OWNER TO charan;

--
-- Name: admin_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.admin_config_id_seq OWNED BY public.admin_config.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.categories (
    name text NOT NULL
);


ALTER TABLE public.categories OWNER TO charan;

--
-- Name: hero_images; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.hero_images (
    id integer NOT NULL,
    image_url character varying(255) NOT NULL,
    title character varying(255),
    subtitle character varying(255),
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.hero_images OWNER TO charan;

--
-- Name: hero_images_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.hero_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.hero_images_id_seq OWNER TO charan;

--
-- Name: hero_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.hero_images_id_seq OWNED BY public.hero_images.id;


--
-- Name: locations; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.locations (
    id integer NOT NULL,
    name text NOT NULL,
    pincode text NOT NULL
);


ALTER TABLE public.locations OWNER TO charan;

--
-- Name: locations_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.locations_id_seq OWNER TO charan;

--
-- Name: locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.locations_id_seq OWNED BY public.locations.id;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.order_items (
    id integer NOT NULL,
    order_id integer,
    product_id integer,
    quantity integer NOT NULL,
    price_vc integer NOT NULL
);


ALTER TABLE public.order_items OWNER TO charan;

--
-- Name: order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_items_id_seq OWNER TO charan;

--
-- Name: order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.order_items_id_seq OWNED BY public.order_items.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    user_id integer,
    total_vc integer NOT NULL,
    status character varying(50) DEFAULT 'PENDING'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    delivery_location text
);


ALTER TABLE public.orders OWNER TO charan;

--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_id_seq OWNER TO charan;

--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: points_history; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.points_history (
    id integer NOT NULL,
    user_id integer,
    amount integer NOT NULL,
    type character varying(50) NOT NULL,
    reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.points_history OWNER TO charan;

--
-- Name: points_history_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.points_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.points_history_id_seq OWNER TO charan;

--
-- Name: points_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.points_history_id_seq OWNED BY public.points_history.id;


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.product_images (
    id integer NOT NULL,
    product_id integer,
    image_url text NOT NULL
);


ALTER TABLE public.product_images OWNER TO charan;

--
-- Name: product_images_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.product_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.product_images_id_seq OWNER TO charan;

--
-- Name: product_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.product_images_id_seq OWNED BY public.product_images.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    price_vc integer NOT NULL,
    image_url character varying(255),
    stock integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    category character varying(100) DEFAULT 'Uncategorized'::character varying,
    is_new_arrival boolean DEFAULT false,
    original_price integer,
    delivery_location text DEFAULT 'Alliance University'::text,
    delivery_time text DEFAULT '7 Days'::text,
    brand text
);


ALTER TABLE public.products OWNER TO charan;

--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.products_id_seq OWNER TO charan;

--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: trusted_brands; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.trusted_brands (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    image_url character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.trusted_brands OWNER TO charan;

--
-- Name: trusted_brands_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.trusted_brands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.trusted_brands_id_seq OWNER TO charan;

--
-- Name: trusted_brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.trusted_brands_id_seq OWNED BY public.trusted_brands.id;


--
-- Name: upcoming_events; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.upcoming_events (
    id integer NOT NULL,
    title character varying(255),
    subtitle character varying(255),
    image_url character varying(255),
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.upcoming_events OWNER TO charan;

--
-- Name: upcoming_events_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.upcoming_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.upcoming_events_id_seq OWNER TO charan;

--
-- Name: upcoming_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.upcoming_events_id_seq OWNED BY public.upcoming_events.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: charan
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    points integer DEFAULT 0,
    is_admin boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.users OWNER TO charan;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: charan
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO charan;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: charan
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: about_image id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.about_image ALTER COLUMN id SET DEFAULT nextval('public.about_image_id_seq'::regclass);


--
-- Name: admin_config id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.admin_config ALTER COLUMN id SET DEFAULT nextval('public.admin_config_id_seq'::regclass);


--
-- Name: hero_images id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.hero_images ALTER COLUMN id SET DEFAULT nextval('public.hero_images_id_seq'::regclass);


--
-- Name: locations id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.locations ALTER COLUMN id SET DEFAULT nextval('public.locations_id_seq'::regclass);


--
-- Name: order_items id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.order_items ALTER COLUMN id SET DEFAULT nextval('public.order_items_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: points_history id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.points_history ALTER COLUMN id SET DEFAULT nextval('public.points_history_id_seq'::regclass);


--
-- Name: product_images id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.product_images ALTER COLUMN id SET DEFAULT nextval('public.product_images_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: trusted_brands id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.trusted_brands ALTER COLUMN id SET DEFAULT nextval('public.trusted_brands_id_seq'::regclass);


--
-- Name: upcoming_events id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.upcoming_events ALTER COLUMN id SET DEFAULT nextval('public.upcoming_events_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: about_image; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.about_image (id, image_url) FROM stdin;
1	https://res.cloudinary.com/do5f2bxko/image/upload/v1775468913/founders_mart/mm29beei0kzoioitazly.jpg
\.


--
-- Data for Name: admin_config; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.admin_config (id, admin_email, admin_password, superadmin_email, superadmin_password, created_at) FROM stdin;
1	ecell@alliance.edu.in	ecell@123	superadmin@alliance.edu.in	superadmin@123	2026-04-07 15:40:51.675861
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.categories (name) FROM stdin;
Electronics
Stationary
Daily  Use
\.


--
-- Data for Name: hero_images; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.hero_images (id, image_url, title, subtitle, active, created_at) FROM stdin;
1	https://res.cloudinary.com/do5f2bxko/image/upload/v1775043826/founders_mart/yjp0onxxacjgo5nc1bn0.png	\N	\N	t	2026-04-01 17:13:47.352469
\.


--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.locations (id, name, pincode) FROM stdin;
1	Alliance University	562106
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.order_items (id, order_id, product_id, quantity, price_vc) FROM stdin;
1	1	1	1	1
2	1	2	1	5
3	2	2	1	5
4	2	4	1	2
5	3	2	1	5
6	3	4	1	2
7	4	2	1	5
8	5	2	1	5
9	6	4	1	2
10	7	1	1	1
11	8	4	1	2
12	9	4	1	2
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.orders (id, user_id, total_vc, status, created_at, delivery_location) FROM stdin;
1	1	6	Delivered	2026-04-07 15:17:40.841727	\N
2	3	7	Delivered	2026-04-09 15:52:39.392071	Alliance University Service Road 562106
4	3	5	Delivered	2026-04-09 16:05:44.755815	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Karpoora, Karpuru, Anekal, Bengaluru Urban, Karnataka, 562106, India"}
3	3	7	Delivered	2026-04-09 15:58:46.685451	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Karpoora, Karpuru, Anekal, Bengaluru Urban, Karnataka, 562106, India"}
7	3	1	Delivered	2026-04-09 16:31:58.520055	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Karpoora, Karpuru, Anekal, Bengaluru Urban, Karnataka, 562106, India"}
6	3	2	Delivered	2026-04-09 16:16:25.703713	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Karpoora, Karpuru, Anekal, Bengaluru Urban, Karnataka, 562106, India"}
5	3	5	Delivered	2026-04-09 16:14:09.050173	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Karpoora, Karpuru, Anekal, Bengaluru Urban, Karnataka, 562106, India"}
8	3	2	Delivered	2026-04-09 16:45:20.378377	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Karpoora, Karpuru, Anekal, Bengaluru Urban, Karnataka, 562106, India"}
9	4	2	Delivered	2026-04-10 10:41:18.191175	{"name":"Alliance University Service Road","pincode":"562106","full":"Alliance University, Alliance University Service Road, Chikkahagade, Anekal, Bengaluru Urban, Karnataka, 562106, India","lat":12.731582573746056,"lon":77.70842976429614}
\.


--
-- Data for Name: points_history; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.points_history (id, user_id, amount, type, reason, created_at) FROM stdin;
1	1	6	deducted	Purchase of 2 items	2026-04-07 15:17:40.841727
2	1	2	added	bonus	2026-04-07 15:18:55.198836
3	1	400	deducted	cost	2026-04-07 15:21:08.828064
4	1	1	added	referral	2026-04-07 15:29:28.00503
5	3	20	added	bonus	2026-04-09 15:52:30.870413
6	3	7	deducted	Purchase of 2 items	2026-04-09 15:52:39.392071
7	3	7	deducted	Purchase of 2 items	2026-04-09 15:58:46.685451
8	3	5	deducted	Purchase of 1 items	2026-04-09 16:05:44.755815
9	3	20	added	c	2026-04-09 16:06:28.63501
10	3	5	deducted	Purchase of 1 items	2026-04-09 16:14:09.050173
11	3	2	deducted	Purchase of 1 items	2026-04-09 16:16:25.703713
12	3	1	deducted	Purchase of 1 items	2026-04-09 16:31:58.520055
13	3	2	deducted	Purchase of 1 items	2026-04-09 16:45:20.378377
14	4	10	added	bonus	2026-04-10 10:40:32.435811
15	4	2	deducted	Purchase of 1 items	2026-04-10 10:41:18.191175
\.


--
-- Data for Name: product_images; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.product_images (id, product_id, image_url) FROM stdin;
1	6	https://res.cloudinary.com/do5f2bxko/image/upload/v1775471985/founders_mart/qjjakqlwh2vg9gbiosiq.webp
2	6	https://res.cloudinary.com/do5f2bxko/image/upload/v1775471986/founders_mart/bzpoozuosjpa2rv0ncku.webp
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.products (id, name, description, price_vc, image_url, stock, created_at, category, is_new_arrival, original_price, delivery_location, delivery_time, brand) FROM stdin;
5	Clay Craft Fine Ceramic Pebble Series Coffee Mug 350ml Orange – Llama Print, Stylish Tea & Coffee Cup, Microwave & Dishwasher Safe, For Home, Office, Café, Gifting, Daily Use, Hot Chocolate, Milk, Tea		25	https://res.cloudinary.com/do5f2bxko/image/upload/v1775470509/founders_mart/qrwrtkthhfigz2yxlqac.png	100	2026-04-06 15:45:10.602337	Daily  Use	f	\N	Alliance University	7 Days	\N
7	Pack of 6 Highlighters Space theme		11	https://res.cloudinary.com/do5f2bxko/image/upload/v1775470628/founders_mart/lsj9pk6hsxlmixebl40x.png	100	2026-04-06 15:47:09.162444	Stationary	f	\N	Alliance University	7 Days	\N
2	HUION HS64 Graphics Drawing Tablet		5	https://res.cloudinary.com/do5f2bxko/image/upload/v1775471220/founders_mart/xsbsbvcrqvysqlpvmuhr.jpg	100	2026-04-06 15:37:49.231926	Daily  Use	t	\N	Alliance University	7 Days	\N
6	Lucacci Deskpad A-60x30CM Non Slip Base Mousepad (Black)		30	https://res.cloudinary.com/do5f2bxko/image/upload/v1775470579/founders_mart/awfjjqo1m68fcrf4jt1x.png	100	2026-04-06 15:46:19.890619	Stationary	t	\N	Alliance University	7 Days	\N
1	Stylo N20 20000mAh Fast Charging Power Bank with in-Built Cable		1	https://res.cloudinary.com/do5f2bxko/image/upload/v1775046455/founders_mart/wmn1cadbpdmdyap1gmmu.png	100	2026-04-01 17:32:45.941175	Electronics	t	\N	Alliance University	7 Days	\N
4	Linear Roller Color Pens Highlighters With 6 Different Curve Shapes,Curve Highlighter Pen Set,Graffiti Pen Art Pen Markers Set,Multi-coloured		2	https://res.cloudinary.com/do5f2bxko/image/upload/v1775470472/founders_mart/ppcgfjqwz2m2xsxbtw8p.png	100	2026-04-06 15:44:33.535673	Stationary	f	\N	Alliance University	7 Days	
\.


--
-- Data for Name: trusted_brands; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.trusted_brands (id, name, image_url, created_at) FROM stdin;
1	Brand	https://res.cloudinary.com/do5f2bxko/image/upload/v1775043992/founders_mart/juejt1swxdtuvlemmqli.png	2026-04-01 17:16:33.440308
2	Brand	https://res.cloudinary.com/do5f2bxko/image/upload/v1775044004/founders_mart/krnswt7tk0zr7iqcewuh.png	2026-04-01 17:16:45.520788
3	Brand	https://res.cloudinary.com/do5f2bxko/image/upload/v1775044014/founders_mart/p956ccqbgns7hmx4j1uu.png	2026-04-01 17:16:54.42956
4	Brand	https://res.cloudinary.com/do5f2bxko/image/upload/v1775044024/founders_mart/vxzcalh8dszgg7gysdfn.png	2026-04-01 17:17:04.66125
\.


--
-- Data for Name: upcoming_events; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.upcoming_events (id, title, subtitle, image_url, active, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: charan
--

COPY public.users (id, name, email, password_hash, points, is_admin, created_at) FROM stdin;
1	charan	cmaruvenibtech22@alliance.edu.in	$2b$10$V7YGF3qrpEwmi39u0y8WT.TfW6v/W.Za25Oggs8HE2X4p3jlRWmJG	96	f	2026-04-01 17:42:43.053238
2	Maruveni Charan	charanm2319@gmail.com	GOOGLE_AUTH_118302473902694646180	0	f	2026-04-07 17:15:45.42287
3	Study	studstudy3441@gmail.com	GOOGLE_AUTH_107241863420776941946	11	f	2026-04-09 15:13:59.639343
4	Charan	cmaruvenibtech22@ced.alliance.edu.in	EMAIL_OTP_AUTH	8	f	2026-04-10 10:29:25.202185
5	Uday	nasina.sankar@alliance.edu.in	EMAIL_OTP_AUTH	0	f	2026-04-10 14:31:05.797591
6	Vishnu	vdasireddybtech22@ced.alliance.edu.in	EMAIL_OTP_AUTH	0	f	2026-04-10 17:17:41.581971
\.


--
-- Name: about_image_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.about_image_id_seq', 1, true);


--
-- Name: admin_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.admin_config_id_seq', 1, true);


--
-- Name: hero_images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.hero_images_id_seq', 1, true);


--
-- Name: locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.locations_id_seq', 1, true);


--
-- Name: order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.order_items_id_seq', 12, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.orders_id_seq', 9, true);


--
-- Name: points_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.points_history_id_seq', 15, true);


--
-- Name: product_images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.product_images_id_seq', 2, true);


--
-- Name: products_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.products_id_seq', 7, true);


--
-- Name: trusted_brands_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.trusted_brands_id_seq', 4, true);


--
-- Name: upcoming_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.upcoming_events_id_seq', 3, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: charan
--

SELECT pg_catalog.setval('public.users_id_seq', 6, true);


--
-- Name: about_image about_image_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.about_image
    ADD CONSTRAINT about_image_pkey PRIMARY KEY (id);


--
-- Name: admin_config admin_config_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.admin_config
    ADD CONSTRAINT admin_config_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (name);


--
-- Name: hero_images hero_images_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.hero_images
    ADD CONSTRAINT hero_images_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: points_history points_history_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.points_history
    ADD CONSTRAINT points_history_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: trusted_brands trusted_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.trusted_brands
    ADD CONSTRAINT trusted_brands_pkey PRIMARY KEY (id);


--
-- Name: upcoming_events upcoming_events_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.upcoming_events
    ADD CONSTRAINT upcoming_events_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: points_history points_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.points_history
    ADD CONSTRAINT points_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: charan
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dcQia1gy9QOJzTOeM4ftwYf2KGQntVdO1AemhiffdTyCtYAVtEi3cOxsdXDFkEA

