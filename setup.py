from setuptools import setup, find_packages

with open("README.md", "r", encoding="ascii") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-16") as f:
    install_requires = f.read().splitlines()

setup(
    name='form_auto_sender',
    version='0.1.0',
    author='Ryousuke Kaga',
    author_email='k222ryousuke@gmail.com',
    description='Send form programatically',
    long_description=long_description,
    long_description_content_type='text/markdown',
    url='https://github.com/thecatblake/form-auto-sender',
    packages=find_packages(),
    classifiers=[
        'Programming Language :: Python :: 3',
        'License :: OSI Approved :: MIT License',
        'Operating System :: OS Independent',
    ],
    python_requires='>=3.12',
    install_requires=install_requires,
)