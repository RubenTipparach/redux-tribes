using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Playables;

public class CutsceneController : MonoBehaviour
{

    public int activeIndex = 0;

    public List<CutsceneSquence> sequences;

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        if(activeIndex < sequences.Count)
        {
            if(Input.GetKeyDown(KeyCode.Space)|| Input.GetKeyDown(KeyCode.KeypadEnter)||Input.GetKeyDown(KeyCode.Return))
            {
                if(sequences[activeIndex].canSkip)
                {
                    var currentSeq = sequences[activeIndex];
                    Debug.Log("current time " + currentSeq.timelineSquence.time);
                    currentSeq.timelineSquence.time = currentSeq.skipToTime;
                    Debug.Log("skipped to time " + currentSeq.timelineSquence.time);
                    activeIndex++;

                }
            }
        }
    }
}


[Serializable]
public class CutsceneSquence{
    public bool canSkip = true;

    public PlayableDirector timelineSquence;

    public float skipToTime;
}