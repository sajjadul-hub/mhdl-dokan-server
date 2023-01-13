const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const e = require('express');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

const app = express();

// middleware
app.use(cors());
app.use(express.json());

/////////////////////////////////////////////////////////////////////////////////////////
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.p1jrtk0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        // Mongodb folder and file add or contion part
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
        const allServicesCollection = client.db('doctorsPortal').collection('allServices');
        const bookingsCollection = client.db('doctorsPortal').collection('booknigs');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');
        const advertisingCollection = client.db('doctorsPortal').collection('advertising');
        const productsCollection = client.db('doctorsPortal').collection('products');
        const reportsProductsCollection = client.db('doctorsPortal').collection('reports');


        // NOTE: make sure you use verifyAdmin after verifyJWT
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        // use Aggregate to query multiple collection and merge data
        app.get('/appointmentOptions', async (req, res) => {
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();
            res.send(options);
        });
        /////////////////////////////


        app.get('/allServices', async (req, res) => {
            const query = {};
            const options = await allServicesCollection.find(query).toArray();
            res.send(options);
        });

        app.get('/allServices/:id', async (req, res) => {
            const id = req.params.id;
            const query = { category_id: id };
            const services = await allServicesCollection.find(query).toArray();
            res.send(services);

        });


        ///////////////////
        app.get('/v2/apponimentOptions', async (req, res) => {
            const option = await appointmentOptionCollection.aggregate([
                {
                    $lookup: {
                        from: 'bookings',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        booked: {
                            $map: {
                                input: '$booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: {
                            $setDifference: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray();
            res.send(option);
        })

        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        })

        /*** z
            *bookings
            *app.get('/bookings')
            *app.get('/bookings/:id')
            *app.post('/bookings')
            *app.patch('/bookings/:id')
            *app.delete('/bookings/:id')
            */

        app.get('/booking', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })


        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            console.log(booking);
            const query = {
                laptopName: booking.laptopName,
                email: booking.email,
                treatment: booking.treatment
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `
                ${booking.laptopName} 
                It's not available now`;
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        })

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' })
        });

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        });
        // Postion for admin =====================================
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })
        // Postion for seller =====================================
        app.get('/users/seller/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isSeller: user?.role === 'seller' });
        })
        // Postion for admin buyer =====================================
        app.get('/users/buyer/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isBuyer: user?.role === 'buyer' });
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })

        app.delete('/users/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.send(result);
        })


        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        })

        app.post('/doctors', verifyJWT, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });
        app.post('/products', async (req, res) => {
            const products = req.body;
            const result = await productsCollection.insertOne(products);
            res.send(result);
        });
        app.post('/reports', async (req, res) => {
            const reportsProducts = req.body;
            const query = {
                buyerName: reportsProducts.buyerName,
                email: reportsProducts.email,
                laptopName: reportsProducts.laptopName
            }
            console.log(query);
            const alreadyReports = await reportsProductsCollection.find(query).toArray();
            if (alreadyReports.length) {
                const message = `
                ${reportsProducts.laptopName} 
                It's already reported`;
                return res.send({ acknowledged: false, message })
            }
            const result = await reportsProductsCollection.insertOne(reportsProducts);
            res.send(result);
        })
        app.get('/reports', async (req, res) => {
            const query = {}
            const reportedproducts = await reportsProductsCollection.find(query).toArray();
            res.send(reportedproducts);
        })


        app.delete('/reports/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await reportsProductsCollection.deleteOne(filter);
            res.send(result);
        })


        app.get('/products/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const products = await productsCollection.find(query).toArray();
            res.send(products);
        })

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })

        // advetsing///////////////////////

        app.post('/advertising', async (req, res) => {
            const booking = req.body;
            console.log(booking);
            const query = {
                title: booking.title,
                email: booking.email,
                price: booking.price,
            }
            const alreadyBooked = await advertisingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `It's already have a advertising ${booking.title}`;
                return res.send({ acknowledged: false, message })
            }
            const result = await advertisingCollection.insertOne(booking);
            res.send(result);
        })

        app.get('/advertising', async (req, res) => {
            const query = {};
            const doctors = await advertisingCollection.find(query).toArray();
            res.send(doctors);
        })

    }
    finally {

    }
}
run().catch(console.log());

app.get('/', async (req, res) => {
    res.send('doctoe portal server is  runnig')
})

app.listen(port, () => console.log(`tech-com  portal runnig ${port}`))