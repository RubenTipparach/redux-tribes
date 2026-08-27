using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;


[System.Serializable]
public class Timing
{

    public float duration;
    public float time;

    public float pausedAt = 0;
    bool initialized = false;
    public float Remaining
    {
        get
        {
            return Mathf.Clamp((duration - (Time.time - time)), 0, float.MaxValue);
        }
    }

    public void Init(){
        StartTimerAt(0);
    }

    public bool Completed()
    {
        return (Time.time - time) >= duration;
    }

    public void FinishTimer()
    {
        time = -duration;
    }

    public void StartTimerAt(float offset)
    {
        initialized = true;
        time = Time.time - offset;
    }

    public float GetProgress 
    {
        get => (Time.time - time) / duration;
    }

    public float GetProgressClamped
    {
        get => Mathf.Clamp((Time.time - time) / duration, 0, 1);
    }

    public void Pause()
    {
        pausedAt = Remaining;
    }

    public void Resume()
    {
        if (initialized)
        {
            duration = pausedAt;
        }

        Init();
    }

}


[System.Serializable]
public class TimingSimulated
{

    public float duration;
    private float time = 0;
    private float timeDelta = 0;

    public bool Completed
    {
        get => (timeDelta - time) > duration;
    }

    public void FinishTimer()
    {
        time = -duration;
    }

    public void StartTimerAt(float offset)
    {
        time = 0 - offset;
        timeDelta = 0;
    }

    public void StartPercentrAt(float offset)
    {
        time = 0;
        timeDelta = offset * duration;
    }

    public void UpdateTime(float deltaTime)
    {
        timeDelta += deltaTime;
    }

    public float GetProgress
    {
        get => (timeDelta - time) / duration;
    }

    public float GetProgressClamped
    {
        get => Mathf.Clamp((timeDelta - time) / duration, 0, 1);
    }

}



[System.Serializable]
public class TimingUnscaled
{

    public float duration = 1;
    private float time;

    public bool Completed
    {
        get => (Time.unscaledTime - time) > duration;
    }

    public void Reset()
    {
        time = -duration;
    }

    public void SetTime(float offset)
    {
        time = Time.unscaledTime - offset;
    }

    public float GetProgress
    {
        get => (Time.unscaledTime - time) / duration;
    }
}