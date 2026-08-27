using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class MusicManager : MonoBehaviour
{
    public AudioClip[] musicClips;
    public AudioSource musicPlayer;

    public bool IsMusicPlaying => musicPlayer.isPlaying;
    void Start()
    {

    }

    public void PlayMusic()
    {
        int randomSong = Random.Range(0, musicClips.Length);

        musicPlayer.clip = musicClips[randomSong];
        musicPlayer.Play();
    }

    public void Pause()
    {
        musicPlayer.Pause();
    }

    public void Resume()
    {
        musicPlayer.UnPause();
    }

    // Update is called once per frame
    void Update()
    {

    }
}
